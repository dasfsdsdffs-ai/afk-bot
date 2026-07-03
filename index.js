const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalFollow, GoalBlock } } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const fs = require('fs');
const { keep_alive } = require("./keep_alive");

keep_alive();

process.on('uncaughtException', function(err) {
  console.log('Uncaught exception:', err.message);
});

let rawdata = fs.readFileSync('config.json');
let data = JSON.parse(rawdata);
var host = data["ip"];
var port = data["port"] || 25565;
var username = data["name"];
var reconnecting = false;
var spawnTime = null;

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
  'witch', 'pillager', 'ravager', 'phantom', 'blaze', 'ghast',
  'slime', 'magma_cube', 'wither_skeleton', 'guardian', 'elder_guardian',
  'hoglin', 'piglin_brute', 'zoglin', 'drowned', 'husk', 'stray',
  'vindicator', 'evoker', 'vex', 'silverfish', 'endermite', 'shulker'
]);

const LOG_BLOCKS = new Set([
  'oak_log','birch_log','spruce_log','jungle_log','acacia_log','dark_oak_log',
  'mangrove_log','cherry_log','oak_wood','birch_wood','spruce_wood','jungle_wood'
]);

const ARMOR_SLOTS = ['head', 'torso', 'legs', 'feet'];
const ARMOR_TYPES = {
  head: ['netherite_helmet','diamond_helmet','iron_helmet','golden_helmet','chainmail_helmet','leather_helmet','turtle_helmet'],
  torso: ['netherite_chestplate','diamond_chestplate','iron_chestplate','golden_chestplate','chainmail_chestplate','leather_chestplate'],
  legs: ['netherite_leggings','diamond_leggings','iron_leggings','golden_leggings','chainmail_leggings','leather_leggings'],
  feet: ['netherite_boots','diamond_boots','iron_boots','golden_boots','chainmail_boots','leather_boots']
};

const DARK_JOIN_MESSAGES = [
  'Birisi daha geldi... İyi ki yalnız değilim artık.',
  'Seni bekliyordum. Uzun zamandır.',
  'Sonunda biri geldi. Çok karanlık burada yalnız.',
  'Hoş geldin... Umarım geri dönebilirsin.',
  'Bir kişi daha geldi. Ya döner ya da dönemez.',
  'Bu sunucuda çok şey döndü. Dikkatli ol.',
  'Karanlık bazen sessiz gelir. Burada olduğunu biliyorum.'
];

function rand(min, max) { return Math.random() * (max - min) + min; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function scheduleReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  console.log('Yeniden bağlanılıyor 5 saniye sonra...');
  setTimeout(function() { reconnecting = false; createBot(); }, 5000);
}

// --- Zırh Giy ---
async function equipArmor(bot) {
  for (const slot of ARMOR_SLOTS) {
    const items = bot.inventory.items();
    for (const armorName of ARMOR_TYPES[slot]) {
      const found = items.find(i => i.name === armorName);
      if (found) {
        try { await bot.equip(found, slot); break; } catch(e) {}
      }
    }
  }
}

// --- Yemek Ye ---
async function eatFood(bot) {
  const foodItems = bot.inventory.items().filter(i => i.foodPoints !== undefined && i.foodPoints > 0);
  if (foodItems.length === 0) return;
  const food = foodItems.sort((a, b) => b.foodPoints - a.foodPoints)[0];
  try {
    await bot.equip(food, 'hand');
    await bot.consume();
    console.log('Yemek yendi:', food.name);
  } catch(e) {}
}

// --- Odun Kes ---
async function mineNearbyLog(bot) {
  try {
    const block = bot.findBlock({
      matching: b => LOG_BLOCKS.has(b.name),
      maxDistance: 12
    });
    if (!block) return false;
    await bot.pathfinder.goto(new GoalBlock(block.position.x, block.position.y, block.position.z));
    await bot.dig(block);
    console.log('Odun kesildi:', block.name);
    return true;
  } catch(e) {
    return false;
  }
}

// --- Kendi Kendine Konuş (nadiren) ---
const selfTalkMessages = [
  'Kimse yok mu burada? Yalnız hissediyorum...',
  'Kurtarır mısınız beni? Burada sıkıştım!',
  'Merhaba? Hellooo? Bi ses yok mu?',
  'Yine tek başımayım, tamam o zaman...',
  'Bu sunucuyu ben mi tutuyorum? Ben tutuyorum.',
  'Burası çok ıssız, hayalet gibi hissediyorum.',
  'FronipeCraft\'a selam olsun! Koruyan benim!',
  'Hâlâ buradayım, hâlâ bekliyorum...',
  'Ben buradayım siz neredesiniz?',
  'Sunucu açık ama içi bomboş... İçim sızlıyor.',
  'Yalnızlık zor ama görevi bırakmam!',
  'Bir maceracı yok mu, gel gel!',
  'Ben gitmiyorum, siz gelin!',
];

function startSelfTalk(bot) {
  var running = true;
  bot.on('end', function() { running = false; });
  bot.on('error', function() { running = false; });
  async function loop() {
    while (running) {
      // 5 dakikada bir
      await sleep(5 * 60 * 1000);
      if (!running) break;
      try {
        const players = Object.values(bot.players).filter(p => p.username !== username);
        // Oyuncu varsa da yoksa da konuş ama farklı mesajla
        const msg = selfTalkMessages[Math.floor(Math.random() * selfTalkMessages.length)];
        bot.chat(msg);
      } catch(e) {}
    }
  }
  loop();
}

// --- Ana Oyun Döngüsü ---
function startGameLoop(bot) {
  var running = true;
  var attacking = false;
  var lastCombatChat = 0;
  var lastClearChat = 0;
  var lastCurrentTarget = null;
  var followingPlayer = null;
  var lastGreetedPlayer = null;
  var lastGreetTime = 0;

  const greetMessages = [
    'Geldim! Seninle birlikteyim.',
    'Yanındayım, endişelenme!',
    'Seni buldum! Koruma görevi başlıyor.',
    'Buradayım! Moblara izin vermem.',
    'Yanına geldim, güvendesin artık!',
  ];

  bot.on('end', function() { running = false; });
  bot.on('error', function() { running = false; });

  const movements = new Movements(bot);
  movements.allowSprinting = true;
  movements.canDig = false;
  bot.pathfinder.setMovements(movements);

  async function loop() {
    while (running) {
      try {
        // 1) Aç ise ye
        if (bot.food !== undefined && bot.food < 14) {
          await eatFood(bot);
        }

        // 2) Can kritikse kaç
        if (bot.health !== undefined && bot.health < 6) {
          bot.pvp.stop();
          attacking = false;
          lastCurrentTarget = null;
          bot.pathfinder.setGoal(null);
          console.log('Can az, kaçılıyor!');
          await sleep(3000);
          continue;
        }

        // 3) Yakındaki düşman mob (20 blok)
        const hostileNearby = Object.values(bot.entities).filter(e => {
          if (!e || !e.name) return false;
          if (!HOSTILE_MOBS.has(e.name)) return false;
          return bot.entity.position.distanceTo(e.position) < 20;
        }).sort((a, b) =>
          bot.entity.position.distanceTo(a.position) -
          bot.entity.position.distanceTo(b.position)
        );

        if (hostileNearby.length > 0) {
          const target = hostileNearby[0];
          const now = Date.now();
          if (target !== lastCurrentTarget && now - lastCombatChat > 5 * 60 * 1000) {
            lastCombatChat = now;
            lastCurrentTarget = target;
            attacking = true;
            console.log('Mob saldırılıyor:', target.name);
            bot.chat('⚔ ' + target.name + ' görüldü, saldırıyorum!');
          } else if (!attacking) {
            attacking = true;
            lastCurrentTarget = target;
          }
          bot.pvp.attack(target);

        } else {
          if (attacking) {
            bot.pvp.stop();
            attacking = false;
            lastCurrentTarget = null;
            const now = Date.now();
            if (now - lastClearChat > 10 * 60 * 1000) {
              lastClearChat = now;
              bot.chat('Temizlendi! Güvendesiniz.');
            }
          }

          // bot.players ile TÜM sunucudaki oyuncuları al (uzaktakiler dahil)
          const allPlayers = Object.values(bot.players).filter(p =>
            p.username !== username && p.entity
          );

          // En yakın oyuncuyu bul (entity varsa)
          const nearestPlayer = allPlayers.sort((a, b) =>
            bot.entity.position.distanceTo(a.entity.position) -
            bot.entity.position.distanceTo(b.entity.position)
          )[0];

          if (nearestPlayer && nearestPlayer.entity) {
            const dist = bot.entity.position.distanceTo(nearestPlayer.entity.position);

            // Yeni bir oyuncuya yaklaştıysa merhaba de (10 dk cooldown)
            const now = Date.now();
            if (
              dist < 8 &&
              nearestPlayer.username !== lastGreetedPlayer &&
              now - lastGreetTime > 10 * 60 * 1000
            ) {
              lastGreetedPlayer = nearestPlayer.username;
              lastGreetTime = now;
              const greet = greetMessages[Math.floor(Math.random() * greetMessages.length)];
              bot.chat(greet);
            }

            // Entity'yi doğrudan takip et — mesafe ne kadar olursa olsun
            bot.pathfinder.setGoal(new GoalFollow(nearestPlayer.entity, 2), true);
            followingPlayer = nearestPlayer.username;
          } else {
            followingPlayer = null;
            bot.pathfinder.setGoal(null);
            await mineNearbyLog(bot);
          }
        }
      } catch(e) {}
      await sleep(500);
    }
  }

  loop();
}

function createBot() {
  var bot;
  try {
    bot = mineflayer.createBot({ host, port, username, version: false });
  } catch (err) {
    console.log('Bot oluşturulamadı:', err.message);
    scheduleReconnect();
    return;
  }

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);

  bot.on('login', function() { console.log("Giriş yapıldı"); });

  bot.on('spawn', async function() {
    spawnTime = Date.now();
    console.log('Bot spawn oldu!');
    bot.chat('FronipeBOT sahadaaa! Arkadaşlarımı korumaya geldim!');
    await sleep(1000);
    await equipArmor(bot);
    startSelfTalk(bot);
    startGameLoop(bot);
  });

  // Envanter değişince zırh giy
  bot.on('playerCollect', async function(collector) {
    if (collector.username === username) {
      await sleep(500);
      await equipArmor(bot);
    }
  });

  // Oyuncu join olunca %5 karanlık mesaj
  bot.on('playerJoined', function(player) {
    if (player.username === username) return;
    if (Math.random() < 0.05) {
      const msg = DARK_JOIN_MESSAGES[Math.floor(Math.random() * DARK_JOIN_MESSAGES.length)];
      setTimeout(function() {
        try { bot.chat(msg); } catch(e) {}
      }, rand(3000, 8000));
    }
  });

  // Ölünce
  bot.on('death', function() {
    console.log('Bot öldü!');
    bot.chat('Öldüm... ama geri döneceğim!');
  });

  bot.on('chat', function(sender, message) {
    if (sender === username) return;
    if (message === '!status') {
      const uptime = spawnTime ? Math.floor((Date.now() - spawnTime) / 1000) : 0;
      const mins = Math.floor(uptime / 60);
      const secs = uptime % 60;
      bot.chat('FronipeBOT aktif! Can: ' + Math.floor(bot.health || 0) + '/20 | Açlık: ' + Math.floor(bot.food || 0) + '/20 | Süre: ' + mins + 'dk ' + secs + 'sn');
    }
  });

  bot.on('error', function(err) {
    console.log('Bot hatası:', err.message);
    scheduleReconnect();
  });

  bot.on('end', function() {
    console.log('Bot bağlantısı kesildi');
    scheduleReconnect();
  });
}

createBot();

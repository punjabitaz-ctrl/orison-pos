'use strict';

const crypto = require('crypto');
const { initDb, hashPin } = require('./db');

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const STORE = {
  id: uuid(),
  code: 'ORSTN-01',
  name: 'Orison Electronics — Main Street',
  address: '12 Main Street',
  phone: '(555) 010-0101',
};

function makeProduct(p, serials = []) {
  const id = uuid();
  const serialRows = serials.map((s) => ({
    id: uuid(),
    product_id: id,
    serial_number: s,
    status: 'IN_STOCK',
    updated_at: now(),
  }));
  return { id, product: { ...p, id, updated_at: now(), created_at: now() }, serialRows };
}

const FIXTURES = [
  // Phones (serialized)
  makeProduct({ sku: 'PH-S24U-256', upc: '0012345620011', name: 'Samsung Galaxy S24 Ultra 256GB', category: 'Phones', cost_price: 1199, retail_price: 1299, is_serialized: 1 },
    ['359999001234567', '359999001234568', '359999001234569', '359999001234570']),
  makeProduct({ sku: 'PH-S24-128', upc: '0012345620028', name: 'Samsung Galaxy S24 128GB', category: 'Phones', cost_price: 799, retail_price: 899, is_serialized: 1 },
    ['359999002345671', '359999002345672', '359999002345673']),
  makeProduct({ sku: 'PH-IP15-128', upc: '0012345620035', name: 'Apple iPhone 15 128GB', category: 'Phones', cost_price: 799, retail_price: 849, is_serialized: 1 },
    ['359999003456782', '359999003456783']),
  makeProduct({ sku: 'PH-IP15PM-256', upc: '0012345620042', name: 'Apple iPhone 15 Pro Max 256GB', category: 'Phones', cost_price: 1099, retail_price: 1199, is_serialized: 1 },
    ['359999004567893', '359999004567894', '359999004567895']),
  makeProduct({ sku: 'PH-G62-128', upc: '0012345620059', name: 'Google Pixel 8a 128GB', category: 'Phones', cost_price: 399, retail_price: 499, is_serialized: 1 },
    ['359999005678904', '359999005678905', '359999005678906', '359999005678907']),
  makeProduct({ sku: 'PH-RN13-128', upc: '0012345620066', name: 'Samsung Galaxy A15 128GB', category: 'Phones', cost_price: 169, retail_price: 219, is_serialized: 1 },
    ['359999006789015', '359999006789016']),

  // Tablets (serialized)
  makeProduct({ sku: 'TB-IPAD10-64', upc: '0012345620073', name: 'Apple iPad 10th Gen 64GB', category: 'Tablets', cost_price: 329, retail_price: 399, is_serialized: 1 },
    ['359999007890126', '359999007890127']),
  makeProduct({ sku: 'TB-S9-128', upc: '0012345620080', name: 'Samsung Galaxy Tab S9 128GB', category: 'Tablets', cost_price: 699, retail_price: 799, is_serialized: 1 },
    ['359999008901237']),

  // Laptops (serialized)
  makeProduct({ sku: 'LT-MBA-M2-256', upc: '0012345620097', name: 'Apple MacBook Air M2 256GB', category: 'Laptops', cost_price: 999, retail_price: 1099, is_serialized: 1 },
    ['C02XK1234567']),
  makeProduct({ sku: 'LT-X13-16', upc: '0012345620103', name: 'Lenovo ThinkPad X13 Gen4', category: 'Laptops', cost_price: 949, retail_price: 1049, is_serialized: 1 },
    ['PF3XK9A2']),
  makeProduct({ sku: 'LT-G14-512', upc: '0012345620110', name: 'ASUS ROG Zephyrus G14', category: 'Laptops', cost_price: 1249, retail_price: 1399, is_serialized: 1 },
    ['N5RQ9XG3']),

  // Audio
  makeProduct({ sku: 'AU-WF1000XM5', upc: '0012345620127', name: 'Sony WF-1000XM5 Earbuds', category: 'Audio', cost_price: 220, retail_price: 299 }),
  makeProduct({ sku: 'AU-AIRPODS3', upc: '0012345620134', name: 'Apple AirPods 3rd Gen', category: 'Audio', cost_price: 159, retail_price: 179 }),
  makeProduct({ sku: 'AU-BOSEQC45', upc: '0012345620141', name: 'Bose QuietComfort 45', category: 'Audio', cost_price: 279, retail_price: 329 }),
  makeProduct({ sku: 'AU-JBLGO4', upc: '0012345620158', name: 'JBL GO 4 Speaker', category: 'Audio', cost_price: 40, retail_price: 49 }),

  // Wearables
  makeProduct({ sku: 'WR-APPLE-S9', upc: '0012345620165', name: 'Apple Watch Series 9 45mm', category: 'Wearables', cost_price: 359, retail_price: 399 }),
  makeProduct({ sku: 'WR-GW6', upc: '0012345620172', name: 'Samsung Galaxy Watch 6', category: 'Wearables', cost_price: 259, retail_price: 299 }),

  // Cables & Chargers
  makeProduct({ sku: 'CB-USBC-1M', upc: '0012345620189', name: 'USB-C Cable 1m (braided)', category: 'Cables', cost_price: 6, retail_price: 12 }),
  makeProduct({ sku: 'CB-LTN-1M', upc: '0012345620196', name: 'Lightning Cable 1m', category: 'Cables', cost_price: 9, retail_price: 18 }),
  makeProduct({ sku: 'CH-65W-GAN', upc: '0012345620202', name: '65W GaN Wall Charger', category: 'Cables', cost_price: 18, retail_price: 32 }),
  makeProduct({ sku: 'CH-WIRELESS-15W', upc: '0012345620219', name: '15W Wireless Charging Pad', category: 'Cables', cost_price: 9, retail_price: 19 }),
  makeProduct({ sku: 'AU-PB-10000', upc: '0012345620226', name: '10000mAh Power Bank', category: 'Cables', cost_price: 14, retail_price: 25 }),

  // Storage & Memory
  makeProduct({ sku: 'ST-SSD-1TB-P5', upc: '0012345620233', name: 'Crucial P5 Plus 1TB NVMe SSD', category: 'Storage', cost_price: 79, retail_price: 109 }),
  makeProduct({ sku: 'ST-SDCARD-128', upc: '0012345620240', name: 'microSD 128GB U3', category: 'Storage', cost_price: 13, retail_price: 22 }),
  makeProduct({ sku: 'ST-SDCARD-64', upc: '0012345620257', name: 'microSD 64GB U1', category: 'Storage', cost_price: 7, retail_price: 13 }),

  // Gaming
  makeProduct({ sku: 'GM-DUALSHOCK5', upc: '0012345620264', name: 'DualSense Wireless Controller', category: 'Gaming', cost_price: 59, retail_price: 74 }),
  makeProduct({ sku: 'GM-PS5SLIM-D', upc: '0012345620271', name: 'PlayStation 5 Slim Disc', category: 'Gaming', cost_price: 429, retail_price: 499, is_serialized: 1 },
    ['PS5D000001', 'PS5D000002', 'PS5D000003']),
  makeProduct({ sku: 'GM-SWITCH-OLED', upc: '0012345620288', name: 'Nintendo Switch OLED', category: 'Gaming', cost_price: 300, retail_price: 349 }),
  makeProduct({ sku: 'GM-XBOXWIRELESS', upc: '0012345620295', name: 'Xbox Wireless Controller', category: 'Gaming', cost_price: 49, retail_price: 59 }),

  // Smart Home & Cameras
  makeProduct({ sku: 'SH-ECOBEE5', upc: '0012345620301', name: 'Ecobee Smart Thermostat', category: 'Smart Home', cost_price: 169, retail_price: 219 }),
  makeProduct({ sku: 'SH-HUE-START', upc: '0012345620318', name: 'Philips Hue Starter Kit', category: 'Smart Home', cost_price: 179, retail_price: 229 }),
  makeProduct({ sku: 'CA-RING-DOORBELL4', upc: '0012345620325', name: 'Ring Video Doorbell 4', category: 'Smart Home', cost_price: 169, retail_price: 199 }),
  makeProduct({ sku: 'CA-CANON-EOSR50', upc: '0012345620332', name: 'Canon EOS R50 + 18-45mm', category: 'Cameras', cost_price: 599, retail_price: 679, is_serialized: 1 },
    ['CE0510123456']),
  makeProduct({ sku: 'CA-GO3', upc: '0012345620349', name: 'DJI Osmo Pocket 3', category: 'Cameras', cost_price: 519, retail_price: 549 }),

  // Networking
  makeProduct({ sku: 'NW-ROUTER-AX55', upc: '0012345620356', name: 'TP-Link Archer AX55', category: 'Networking', cost_price: 89, retail_price: 119 }),
  makeProduct({ sku: 'NW-MESH-EERO6', upc: '0012345620363', name: 'Eero 6 Mesh (3-pack)', category: 'Networking', cost_price: 164, retail_price: 199 }),
  makeProduct({ sku: 'NW-RS485-CBL', upc: '0012345620370', name: 'Cat6 Ethernet Cable 10m', category: 'Networking', cost_price: 8, retail_price: 16 }),

  // Accessories & Misc
  makeProduct({ sku: 'AC-SCREEN-S24U', upc: '0012345620387', name: 'Tempered Glass — Galaxy S24 Ultra', category: 'Accessories', cost_price: 4, retail_price: 12 }),
  makeProduct({ sku: 'AC-CASE-IP15', upc: '0012345620394', name: 'Silicone Case — iPhone 15', category: 'Accessories', cost_price: 8, retail_price: 19 }),
  makeProduct({ sku: 'AC-HDMI-2M', upc: '0012345620400', name: 'HDMI 2.1 Cable 2m', category: 'Cables', cost_price: 10, retail_price: 24 }),
  makeProduct({ sku: 'AC-ADAPTER-LT', upc: '0012345620417', name: 'USB-C Laptop Adapter 100W', category: 'Cables', cost_price: 28, retail_price: 49 }),
  makeProduct({ sku: 'AC-STAND-LAPTOP', upc: '0012345620424', name: 'Laptop Stand — Aluminum', category: 'Accessories', cost_price: 15, retail_price: 29 }),
];

const INVENTORY_QTY = {
  'PH-S24U-256': 6, 'PH-S24-128': 8, 'PH-IP15-128': 10, 'PH-IP15PM-256': 4,
  'PH-G62-128': 9, 'PH-RN13-128': 12, 'TB-IPAD10-64': 5, 'TB-S9-128': 3,
  'LT-MBA-M2-256': 4, 'LT-X13-16': 3, 'LT-G14-512': 2,
  'AU-WF1000XM5': 8, 'AU-AIRPODS3': 10, 'AU-BOSEQC45': 6, 'AU-JBLGO4': 15,
  'WR-APPLE-S9': 5, 'WR-GW6': 5,
  'CB-USBC-1M': 40, 'CB-LTN-1M': 30, 'CH-65W-GAN': 25, 'CH-WIRELESS-15W': 20, 'AU-PB-10000': 18,
  'ST-SSD-1TB-P5': 12, 'ST-SDCARD-128': 25, 'ST-SDCARD-64': 25,
  'GM-DUALSHOCK5': 9, 'GM-PS5SLIM-D': 5, 'GM-SWITCH-OLED': 6, 'GM-XBOXWIRELESS': 9,
  'SH-ECOBEE5': 7, 'SH-HUE-START': 6, 'CA-RING-DOORBELL4': 7, 'CA-CANON-EOSR50': 2,
  'CA-GO3': 4, 'NW-ROUTER-AX55': 8, 'NW-MESH-EERO6': 4, 'NW-RS485-CBL': 20,
  'AC-SCREEN-S24U': 30, 'AC-CASE-IP15': 25, 'AC-HDMI-2M': 20, 'AC-ADAPTER-LT': 15, 'AC-STAND-LAPTOP': 12,
};

// Serialized products that have MORE serials on hand than the INVENTORY_QTY would
// suggest can be reconciled automatically: on-hand = count(serials IN_STOCK) when
// is_serialized. The explicit qty above only applies to non-serialized items.

function seed() {
  const db = initDb();
  const txn = db.transaction(() => {
    const storeCount = db.prepare('SELECT COUNT(*) AS c FROM stores').get().c;
    if (storeCount > 0) {
      console.log('DB already seeded — skipping. Delete data/orison.db to reseed.');
      return;
    }

    db.prepare(
      `INSERT INTO stores (id, code, name, address, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(STORE.id, STORE.code, STORE.name, STORE.address, STORE.phone, now());

    const users = [
      { id: uuid(), first_name: 'Tariq', last_name: 'Al-Sayed', email: 'tariq@orisonigt.com', pin: '1234', role: 'admin' },
      { id: uuid(), first_name: 'Amara', last_name: 'Njoku', email: 'amara@orisonigt.com', pin: '5678', role: 'cashier' },
      { id: uuid(), first_name: 'Diego', last_name: 'Ramirez', email: 'diego@orisonigt.com', pin: '9012', role: 'cashier' },
    ];
    const insUser = db.prepare(
      `INSERT INTO users (id, store_id, first_name, last_name, email, pin_hash, role, active, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    );
    for (const u of users) {
      insUser.run(u.id, STORE.id, u.first_name, u.last_name, u.email, hashPin(u.pin), u.role, now(), now());
    }

    const insProduct = db.prepare(
      `INSERT INTO products (id, sku, upc, name, category, cost_price, retail_price, is_serialized, active, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    );
    const insInventory = db.prepare(
      `INSERT INTO inventory (id, store_id, product_id, quantity_on_hand, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const insSerial = db.prepare(
      `INSERT INTO product_serials (id, product_id, serial_number, status, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );

    for (const { id, product, serialRows } of FIXTURES) {
      insProduct.run(id, product.sku, product.upc, product.name, product.category,
        product.cost_price, product.retail_price, product.is_serialized, now(), now());
      const serialCount = serialRows.length;
      const qtyHand = product.is_serialized
        ? serialCount
        : (INVENTORY_QTY[product.sku] ?? 0);
      insInventory.run(uuid(), STORE.id, id, qtyHand, now());
      for (const s of serialRows) {
        insSerial.run(s.id, s.product_id, s.serial_number, s.status, s.updated_at);
      }
    }
  });

  txn();
  console.log(`Seeded ${FIXTURES.length} products into store "${STORE.name}".`);
  console.log('  Admin login: tariq@orisonigt.com / PIN 1234');
  console.log('  Cashier login: amara@orisonigt.com / PIN 5678');
}

if (require.main === module) {
  seed();
}

module.exports = { seed, STORE };
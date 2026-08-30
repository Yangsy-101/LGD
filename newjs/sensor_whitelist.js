/**
 * 传感器白名单数据
 * 用于 RFID核验 — 每条传感器数据的 ID 需在白名单中才能通过核验
 *
 * 数据结构：
 *   SENSOR_WHITELIST[传感器类型][设备ID] = { name, location, access }
 *
 * 传感器类型（对应数据格式中的字段4）：
 *   LightIntensity  — 光照传感器
 *   Temperature     — 温湿度传感器
 *   WindSpeed       — 风速传感器
 *   Loudness        — 响度传感器
 */

const SENSOR_WHITELIST = {
    // 光照传感器
    "LightIntensity": {
        "F938712472AB": { name: "光照传感器 #01", location: "海口环海公路 A段", access: "ble" },
        "A1234567890B": { name: "光照传感器 #02", location: "海口环海公路 B段", access: "wifi" },
        "B2345678901C": { name: "光照传感器 #03", location: "海口环海公路 C段", access: "sub1g" },
        "C3456789012D": { name: "光照传感器 #04", location: "监测塔 1F",      access: "5g" },
        "D4567890123E": { name: "光照传感器 #05", location: "监测塔 2F",      access: "ble" },
    },
    // 温湿度传感器
    "Temperature": {
        "E5678901234F": { name: "温湿度传感器 #01", location: "海口环海公路 A段", access: "wifi" },
        "F6789012345A": { name: "温湿度传感器 #02", location: "海口环海公路 B段", access: "5g" },
        "A7890123456B": { name: "温湿度传感器 #03", location: "海口环海公路 C段", access: "sub1g" },
        "B8901234567C": { name: "温湿度传感器 #04", location: "监测塔 1F",      access: "wifi" },
        "C9012345678D": { name: "温湿度传感器 #05", location: "监测塔 2F",      access: "5g" },
    },
    // 风速传感器
    "WindSpeed": {
        "D0123456789E": { name: "风速传感器 #01", location: "极地 A站", access: "5g" },
        "E1234567890F": { name: "风速传感器 #02", location: "极地 B站", access: "sub1g" },
        "F2345678901A": { name: "风速传感器 #03", location: "极地 C站", access: "wifi" },
        "A3456789012B": { name: "风速传感器 #04", location: "极地 D站", access: "5g" },
        "B4567890123C": { name: "风速传感器 #05", location: "极地 E站", access: "sub1g" },
    },
    // 响度传感器
    "Loudness": {
        "C5678901234D": { name: "响度传感器 #01", location: "海口环海公路 A段", access: "wifi" },
        "D6789012345E": { name: "响度传感器 #02", location: "海口环海公路 B段", access: "5g" },
        "E7890123456F": { name: "响度传感器 #03", location: "海口环海公路 C段", access: "sub1g" },
        "F8901234567A": { name: "响度传感器 #04", location: "监测塔 1F",      access: "ble" },
        "A9012345678B": { name: "响度传感器 #05", location: "监测塔 2F",      access: "wifi" },
    },
};

// 获取通信方式的中文标签
function getAccessLabel(access) {
    const map = {
        'ble':   'BLE',
        'wifi':  'Wifi',
        'sub1g': 'Sub1G',
        '5g':    '5G',
    };
    return map[access] || access.toUpperCase();
}

// 获取通信方式对应的 CSS 类名
function getAccessClass(access) {
    return 'access-' + access;
}

// 获取所有白名单中的传感器总数
function getWhitelistSensorCount() {
    let count = 0;
    Object.values(SENSOR_WHITELIST).forEach(devices => {
        count += Object.keys(devices).length;
    });
    return count;
}

// 获取所有白名单传感器类型
function getWhitelistSensorTypes() {
    return Object.keys(SENSOR_WHITELIST);
}

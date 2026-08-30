# project2-0 子网页 README

## 项目简介
`project2-0` 是 `ControlPlatform` 中“基于低轨卫星的数据接入系统”子网页，负责展示接入点地图、实时传感器数据、趋势图以及可编辑链路结构图。

## 功能组成
- 地图模块：展示 6 个接入点位置，并根据瓦片可用性自动切换地图底图。
- 实时数据模块：轮询后端接口，刷新温度、湿度、气压、噪声四类指标。
- 趋势图模块：通过历史数据与增量数据绘制 Chart.js 折线图。
- 结构图模块：使用 X6 绘制链路结构，并把布局保存到 SQLite；新上传图片会落盘到 `assets/images/layout/`。

## 技术栈
- 前端：HTML、CSS、JavaScript。
- 可视化：Leaflet、Chart.js、X6、Three.js 扩展球体组件。
- 后端：Flask + SQLite。
- 数据源：本地模拟器写入的 SQLite 传感器数据；后端保留 Open-Meteo 相关实时气象辅助逻辑。

## 快速开始
1. 启动后端服务。

```bash
cd project2-0
python backend/server.py
```

2. 默认会自动启动数据模拟器；如果显式关闭了自动模拟，也可手动启动数据模拟器。

```bash
python backend/data_simulator.py
```

3. 打开页面。
- 通过 `ControlPlatform` 总控平台进入。
- 或直接访问 `project2-0/index.html`。

## 目录结构
```text
project2-0/
├─ assets/
│  ├─ css/                    # 页面样式
│  ├─ js/                     # 前端逻辑脚本
│  ├─ vendor/                 # 本地第三方依赖（Leaflet、X6）
│  └─ images/                 # 页面图片、校徽、结构图节点图片、结构图上传图片
├─ backend/
│  ├─ server.py               # Flask API、静态资源服务、结构图上传接口
│  └─ data_simulator.py       # 本地模拟数据源
├─ data/
│  ├─ satellite_data.db       # SQLite 数据库
│  └─ layout_backups/         # 结构图布局落盘备份，后端仅保留最新 1 份
├─ index.html                 # 页面入口
└─ README.md                  # 项目说明文档
```

## 关键接口
- `GET /api/access_points`：接入点基础信息。
- `GET /api/latest`：指定接入点的最新数据。
- `GET /api/incremental`：指定接入点的增量数据。
- `GET /api/chart`：趋势图历史数据。
- `GET /api/stats`：统计摘要。
- `GET /api/layout`：读取当前结构图布局。
- `POST /api/layout`：保存结构图布局。
- `POST /api/layout/upload-image`：上传结构图图片并保存到 `assets/images/layout/`。
- `GET /api/layout/history`：查看布局历史。
- `POST /api/layout/restore`：恢复指定历史布局。

## 卫星网关数据源

- 后端通过 `http://192.168.0.233:10014/events` 持续订阅核心网关 SSE 数据，并把核心记录 ID 一同落库；重启后从本地游标续传。
- `gateway1` 至 `gateway5` 依次对应南京邮电大学物联网研究院、溧水、海南、渤海、黄海。
- 后端从核心网关取得标准化报文后，将 `t/s/v/g` 分别保存为 `event_time`、`sensor_type`、`sensor_value`、`gateway_number`。
- 火情另存为 `fire_detected`（0/1），风速另存为 `wind_speed`（m/s），完整原始报文保存在 `raw_payload_json`。
- SQLite 表 `satellite_sensor_records` 按 `message_id` 去重，每个 gateway 仅保留最近 30 条；后端重启不会清空记录。
- 可用环境变量 `SATELLITE_SOURCE_BASE_URL` 和 `SATELLITE_SOURCE_TIMEOUT_SECONDS` 覆盖核心网关地址与连接超时。

## 维护说明
- `data/satellite_data.db`、`data/layout_backups/`、`__pycache__/`、`*.db-shm`、`*.db-wal` 都属于运行期产物。
- `assets/images/layout/` 存放结构图上传图片文件；布局 JSON / SQLite 只记录相对路径，不再保存新的 Base64 大图。
- `data/layout_backups/` 仅作为文件级兜底备份，当前布局和历史记录的主读取源仍是 SQLite；后端会自动清理，只保留最新 1 份 JSON。
- 前端 `dist` 部署只需要 `index.html` 和 `assets/`，不需要复制 `backend/` 和 `data/`。
- 根目录中的恢复试验文件已清理，正式布局以数据库和 `data/layout_backups/` 为准。

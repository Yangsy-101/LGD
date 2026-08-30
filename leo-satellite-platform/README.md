# project2-0 子网页 README

## 项目简介
`project2-0` 是 `ControlPlatform` 中“基于低轨卫星的数据接入系统”子网页，负责展示低轨卫星接入链路，以及溧水森林、海南远洋远域两个差异化任务场景。

## 功能组成
- 多场景监测：原有 `index.html` 保留卫星链路拓扑和监测点地图，并在遥测区域切换溧水森林、海南远洋远域，分别展示火情或风速载荷。
- 时间与时延：每个场景均展示采集时间、服务器入库时间和端到端时延差。
- 链路证明：展示终端、低轨卫星、地面信关站、数据中心四段链路，以及 SSE 连接状态和最近报文证据。
- 地图模块：展示 2 个接入点位置，并根据瓦片可用性自动切换地图底图。
- 结构图模块：使用 X6 绘制链路结构，并把布局保存到 SQLite；新上传图片会落盘到 `assets/images/layout/`。

## 技术栈
- 前端：HTML、CSS、JavaScript。
- 可视化：Leaflet、Chart.js、X6、Three.js 扩展球体组件。
- 后端：Flask + SQLite。
- 数据源：核心网关 `10014/events` 的 SSE 卫星遥测流，落库到 SQLite。
- 页面优先读取 SQLite 的 `satellite_sensor_records` 已入库记录。森林尚未收到真实 `gateway1 + TH` 时，温湿度会暂时回退显示原 `sensor_logs` 历史数据；收到首条真实 TH 后自动切换为核心网关 SSE 数据。

## 快速开始
1. 启动后端服务。

```powershell
cd "D:\桌面\LGD\lgd2\leo-satellite-platform"
python backend/server.py
```

2. 打开页面。
- 通过 `ControlPlatform` 总控平台进入。
- 或访问 `http://127.0.0.1:8090/`，不要直接双击 `index.html`。

## 联调脚本

`simulate_satellite_uplink.py` 按《卫星数据报文格式说明》构造上行二进制报文，仅用于联调。正式运行界面时不需要启动它。先用 `--dry-run` 检查报文，不会连接外部服务器：

```bash
python simulate_satellite_uplink.py --dry-run --no-wait
```

不应在生产使用中运行 `backend/demo_fire_alarm.py`，它会直接写入本地演示火警记录。

## 统一数据通路

```text
卫星模组 / 上行链路
  → 核心网关 http://192.168.0.233:10014/events（SSE）
  → backend/server.py 解析、校验、去重
  → data/satellite_data.db / satellite_sensor_records
  → 本地 /api/*
  → 前端每 5 秒读取展示
```

分类规则：

- `gateway1 + F`：溧水森林火警；`/api/latest`、`/api/chart`。
- `gateway1 + TH`：溧水森林温湿度；`/api/environment`。
- `gateway2 + WS`：海南远洋风速；`/api/latest`、`/api/chart`。
- `gateway3 + F`：正常接收并入库，但当前两场景页面不展示。

当前展示环境未连接 10014 或尚未收到 TH 时，`/api/environment` 会读取旧 `sensor_logs` 中 `sn_code=14196` 的温湿度；该兜底仅用于展示，不会生成新数据，也不会影响 SSE 游标。

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
│  ├─ demo_fire_alarm.py      # 一次性森林火情报警演示脚本
│  └─ clear_satellite_data.py # 卫星记录备份与清理工具
├─ data/
│  ├─ satellite_data.db       # SQLite 数据库
│  └─ layout_backups/         # 结构图布局落盘备份，后端仅保留最新 1 份
├─ index.html                 # 页面入口
└─ README.md                  # 项目说明文档
```

## 关键接口
- `GET /api/access_points`：接入点基础信息。
- `GET /api/link-status`：核心网关 SSE 与各场景最近遥测状态。
- `GET /api/latest`：指定接入点的最新数据。
- `GET /api/incremental`：指定接入点的增量数据。
- `GET /api/chart`：趋势图历史数据。
- `GET /api/environment`：森林 `gateway1 + TH` 温湿度历史。
- `GET /api/stats`：统计摘要。
- `GET /api/layout`：读取当前结构图布局。
- `POST /api/layout`：保存结构图布局。
- `POST /api/layout/upload-image`：上传结构图图片并保存到 `assets/images/layout/`。
- `GET /api/layout/history`：查看布局历史。
- `POST /api/layout/restore`：恢复指定历史布局。

## 卫星网关数据源

- 后端持续订阅 `http://192.168.0.233:10014/events` 的 SSE 数据，并根据本地 `source_record_id` 游标续传。
- 保留核心网关原始载荷规则：`gateway1` 接收火情 `F` 和温湿度 `TH`；`gateway2` 接收风速 `WS`；`gateway3` 可接收火情 `F`。
- 场景绑定为：`gateway1` 溧水森林、`gateway2` 海南远洋远域。
- `t/s/v/g` 分别保存为采集时间、传感器类型、传感器值和网关编号；TH 的 `v.tp`、`v.rh` 分别保存为 `temperature`、`humidity`；`server_received_timestamp` 作为服务器入库时间。
- SQLite 表 `satellite_sensor_records` 按 `message_id` 去重，每个 `gateway + sensor_type` 数据流仅保留最近 30 条。
- SSE 游标使用已成功提交数据库的 `source_record_id`；无记录、格式错误或入库失败时不会推进游标。
- 可用环境变量 `SATELLITE_SOURCE_BASE_URL`、`SATELLITE_SOURCE_TIMEOUT_SECONDS` 覆盖核心网关地址和连接超时；测试可用 `PROJECT20_DATABASE` 指向隔离数据库。
- 后端启动时会幂等增加旧库缺少的 `temperature`、`humidity` 列，不删除既有记录。

## 维护说明
- `data/satellite_data.db`、`data/layout_backups/`、`__pycache__/`、`*.db-shm`、`*.db-wal` 都属于运行期产物。
- `assets/images/layout/` 存放结构图上传图片文件；布局 JSON / SQLite 只记录相对路径，不再保存新的 Base64 大图。
- `data/layout_backups/` 仅作为文件级兜底备份，当前布局和历史记录的主读取源仍是 SQLite；后端会自动清理，只保留最新 1 份 JSON。
- 前端 `dist` 部署只需要 `index.html` 和 `assets/`，不需要复制 `backend/` 和 `data/`。
- 根目录中的恢复试验文件已清理，正式布局以数据库和 `data/layout_backups/` 为准。

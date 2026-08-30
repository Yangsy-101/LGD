const { useState, useEffect } = React;

// --- 1. 图标组件定义 (内联 SVG 以确保无需额外依赖) ---
const IconWrapper = ({ children, size = 24, className = "", ...rest }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        width={size} 
        height={size} 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        className={className}
        {...rest}
    >
        {children}
    </svg>
);

const Activity = (props) => <IconWrapper {...props}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></IconWrapper>;
const Flame = (props) => <IconWrapper {...props}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-2.246-5.362-6.75-5.362 1.333 2.722 1.333 5.113 0 7.362 2.5-1 4.11-1.22 6.5.5zM15.5 14.5A2.5 2.5 0 0 0 18 12c0-1.38-.5-2-1-3-1.072-2.143-2.246-5.362-6.75-5.362 1.333 2.722 1.333 5.113 0 7.362 2.5-1 4.11-1.22 6.5.5z"/></IconWrapper>;
const Wind = (props) => <IconWrapper {...props}><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></IconWrapper>;
const Thermometer = (props) => <IconWrapper {...props}><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></IconWrapper>;
const Video = (props) => <IconWrapper {...props}><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></IconWrapper>;
const Cpu = (props) => <IconWrapper {...props}><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></IconWrapper>;
const Radio = (props) => <IconWrapper {...props}><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></IconWrapper>;
const Wifi = (props) => <IconWrapper {...props}><path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/></IconWrapper>;
const Router = (props) => <IconWrapper {...props}><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6.01 18h.01"/><path d="M10.01 18h.01"/><path d="M15 10v4"/><path d="M17.84 7.17a4 4 0 0 0-5.66 0"/><path d="M20.66 4.34a8 8 0 0 0-11.31 0"/></IconWrapper>;
const Monitor = (props) => <IconWrapper {...props}><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></IconWrapper>;
const Database = (props) => <IconWrapper {...props}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></IconWrapper>;
const Cloud = (props) => <IconWrapper {...props}><path d="M17.5 19c0-3.037-2.463-5.5-5.5-5.5S6.5 15.963 6.5 19"/><path d="M17.5 19c2.485 0 4.5-2.015 4.5-4.5S19.985 10 17.5 10c0-3.866-3.134-7-7-7s-7 3.134-7 7c-2.485 0-4.5 2.015-4.5 4.5S5.515 19 8 19"/></IconWrapper>;
const Globe = (props) => <IconWrapper {...props}><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></IconWrapper>;
const Server = (props) => <IconWrapper {...props}><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></IconWrapper>;
const CircuitBoard = (props) => <IconWrapper {...props}><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M11 9h4a2 2 0 0 0 2-2V3"/><circle cx="9" cy="9" r="2"/><path d="M7 21v-4a2 2 0 0 1 2-2h4"/><circle cx="15" cy="15" r="2"/></IconWrapper>;
const ShieldAlert = (props) => <IconWrapper {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/></IconWrapper>;
const Zap = (props) => <IconWrapper {...props}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></IconWrapper>;

// --- 2. 拓扑图组件 ---
const ConnectionLine = ({ startX, startY, endX, endY, id, color="#4A90E2", dashed=true, ballColor="#FFE600", hasArrow=false, arrowId="arrow-yellow" }) => {
  const pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
  return (
    <g>
      <path 
        id={id} 
        d={pathD} 
        fill="none" 
        stroke={color} 
        strokeWidth="4" 
        strokeDasharray={dashed ? "8 4" : "none"} 
        opacity="0.9" 
        markerEnd={hasArrow ? `url(#${arrowId})` : undefined}
      />
      <circle r="6" fill={ballColor}>
        <animateMotion dur="3s" repeatCount="indefinite" rotate="auto">
          <mpath href={`#${id}`} />
        </animateMotion>
      </circle>
    </g>
  );
};

const TopologyGraph = ({ networkMode = '5G', fireStatus = 'normal' }) => {
  const isShortwave = networkMode === 'Shortwave';
  const activeColor = '#22d3ee';
  const inactiveColor = '#475569';
  const alertColor = '#ef4444';
  
  return (
    <svg className="w-full h-full absolute inset-0 pointer-events-none" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid meet">
      <defs>
        {/* 黄色实线箭头 */}
        <marker id="arrow-yellow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 L2,4 Z" fill="#FFE600" />
        </marker>
        {/* 橙色虚线箭头 */}
        <marker id="arrow-orange" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 L2,4 Z" fill="#FF9800" />
        </marker>
        {/* 淡黄色实线箭头 */}
        <marker id="arrow-pale-yellow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 L1.5,3 Z" fill="#FDE047" />
        </marker>
        {/* 蓝色虚线箭头 */}
        <marker id="arrow-blue" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 L2,4 Z" fill="#4A90E2" />
        </marker>
        <filter id="glow-cyan">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feFlood floodColor="#22d3ee" floodOpacity="0.5"/>
          <feComposite in2="coloredBlur" operator="in" result="glow"/>
          <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* ========== 连线层 (底层 - 背景) ========== */}
      <g id="connections-bottom">
         {/* 上传公网及云服务器 (蓝色虚线) */}
         {/* 东大 5G/WiFi -> 公网 */}
         <ConnectionLine startX={750} startY={670} endX={130} endY={500} id="conn-dongda-public" color="#4A90E2" dashed={true} ballColor="#FFE600" hasArrow={true} arrowId="arrow-blue" />
         {/* 宝通 天通 -> 公网 */}
         <ConnectionLine startX={335} startY={365} endX={130} endY={450} id="conn-baotong-public" color="#4A90E2" dashed={true} ballColor="#FFE600" hasArrow={true} arrowId="arrow-blue" />
         {/* 公网 -> 云服务器 (中间位置) */}
         <ConnectionLine startX={80} startY={400} endX={425} endY={70} id="conn-public-cloud" color="#4A90E2" dashed={true} ballColor="#FFE600" hasArrow={true} arrowId="arrow-blue" />
      </g>

      {/* ========== 下方区域：端侧 ========== */}
      <g id="bottom-sensors" transform="translate(30, 870)">
         {/* 端侧外框 - 包含所有传感器 */}
         <rect x="0" y="100" width="1540" height="180" rx="12" 
               fill="none" stroke="#4A90E2" strokeWidth="3" strokeDasharray="12 6" />
         <text x="20" y="80" fill="#4A90E2" fontSize="35" fontWeight="bold">端侧</text>
         
         {/* 南邮传感器组 */}
         <g transform="translate(40, 25)">
           
            <SensorBox x={0} y={130} width={200} height={90} label="摄像头" icon={<Video size={32}/>} fontSize={23} />
            <SensorBox x={220} y={130} width={200} height={90} label="温湿度" icon={<Thermometer size={32}/>} alert={fireStatus==='fire'} fontSize={23} />
            <SensorBox x={440} y={130} width={200} height={90} label="烟感" icon={<Zap size={32}/>} alert={fireStatus==='fire'} fontSize={23} />
         </g>
         
         {/* 58所传感器组 */}
         <g transform="translate(750, 25)">
            
            <SensorBox x={0} y={130} width={180} height={90} label="风速计" icon={<Wind size={32}/>} color="#a855f7" fontSize={23} />
            <SensorBox x={200} y={130} width={180} height={90} label="温湿度" icon={<Thermometer size={32}/>} color="#a855f7" fontSize={23} />
            <SensorBox x={400} y={130} width={180} height={90} label="光照" icon={<Thermometer size={32}/>} color="#a855f7" fontSize={23} />
            <SensorBox x={600} y={130} width={180} height={90} label="响度计" icon={<Thermometer size={32}/>} color="#a855f7" fontSize={23} />
         </g>
      </g>

      {/* ========== 边缘网关设备大框 ========== */}
      <g id="edge-gateway-container" transform="translate(200, 200)">
         <rect width="1280" height="640" rx="20" 
               fill="none" stroke="#377cdbff" strokeWidth="4" strokeDasharray="20 10" />
         <text x="500" y="50" fill="#377cdbff" fontSize="40" fontWeight="bold">边缘网关设备</text>
      </g>

      {/* ========== 中央区域：东大模块（核心） ========== */}
      <g id="center-dongda" transform="translate(650, 450)">
         {/* 东大工控板 - 核心模块，最大 */}
         <rect width="340" height="280" rx="8" fill="#1e293b" stroke="#22d3ee" strokeWidth="4" filter="url(#glow-cyan)"/>
         <Cpu x="20" y="20" size={48} className="text-cyan-400"/>
         <text x="80" y="55" fill="#e2e8f0" fontSize="28" fontWeight="bold">东大-工控板</text>
         
         
         {/* 网口 */}
         <g transform="translate(100, 90)">
            <rect width="140" height="80" rx="6" fill="#0f172a" stroke="#10B981" strokeWidth="2"/>
            <CircuitBoard x="15" y="15" size={28} className="text-green-400"/>
            <text x="15" y="60" fill="#e2e8f0" fontSize="22" fontWeight="bold">网口</text>
         </g>

         {/* 5G WiFi 模块 */}
         <g transform="translate(100, 180)">
            <rect width="140" height="80" rx="6" fill="#0f172a" stroke="#3b82f6" strokeWidth="2"/>
            <Wifi x="15" y="15" size={28} className="text-blue-400"/>
            <text x="15" y="60" fill="#e2e8f0" fontSize="22" fontWeight="bold">5G/WiFi</text>
         </g>
         
         
      </g>
      
      {/* ========== 围绕东大模块的边缘设备 ========== */}
      {/* 左侧：宝通工控机（一体化） */}
      <g id="baotong-controller" transform="translate(240, 250)">
         {/* 宝通工控机外框 - 扩大以包含所有组件 */}
         <rect x="0" y="0" width="360" height="300" rx="10" 
               fill="none" stroke="#3b82f6" strokeWidth="3" />
         <text x="30" y="45" fill="#ffffffff" fontSize="26" fontWeight="bold">宝通-工控机</text>
         
         {/* 上排：HF/VHF 和 天通 */}
         <g transform="translate(20, 70)">
            <g transform="translate(0, 0)">
               <rect width="150" height="90" rx="6" fill="#1e293b" stroke="#22d3ee" strokeWidth="2"/>
               <Radio x="15" y="15" size={32} className="text-cyan-400"/>
               <text x="15" y="60" fill="#e2e8f0" fontSize="22" fontWeight="bold">天通模块</text>
               
            </g>
            
            <g transform="translate(170, 0)">
               <rect width="150" height="90" rx="6" fill="#1e293b" stroke="#22d3ee" strokeWidth="2"/>
               <Radio x="15" y="15" size={32} className="text-cyan-400"/>
               <text x="15" y="60" fill="#e2e8f0" fontSize="22" fontWeight="bold">HF/VHF模块</text>
               
            </g>
         </g>
         
         {/* 下排：5G WiFi 和 网口 */}
         <g transform="translate(20, 180)">
            {/* 5G WiFi */}
            <g transform="translate(0, 0)">
               <rect width="150" height="90" rx="6" fill="#1e293b" stroke="#3b82f6" strokeWidth="2"/>
               <Wifi x="15" y="15" size={32} className="text-blue-400"/>
               <text x="15" y="60" fill="#e2e8f0" fontSize="22" fontWeight="bold">5G/WiFi</text>
            </g>
            
            {/* 网口 */}
            <g transform="translate(170, 0)">
               <rect width="150" height="90" rx="6" fill="#1e293b" stroke="#10B981" strokeWidth="2"/>
               <CircuitBoard x="15" y="15" size={32} className="text-green-400"/>
               <text x="15" y="60" fill="#e2e8f0" fontSize="22" fontWeight="bold">网口</text>
            </g>
         </g>
      </g>
      
      {/* 右上：南邮边缘计算模块 */}
      <g id="nanjing-edge" transform="translate(300, 600)">
         <rect width="240" height="200" rx="6" fill="#1e293b" stroke="#f59e0b" strokeWidth="3"/>
         <CircuitBoard x="35" y="25" size={44} className="text-orange-400"/>
         <text x="35" y="90" fill="#e2e8f0" fontSize="24" fontWeight="bold">南邮-边缘计算模块</text>
         
         
         {/* 网口 */}
         <g transform="translate(35, 110)">
            <rect width="140" height="80" rx="6" fill="#0f172a" stroke="#10B981" strokeWidth="2"/>
            <CircuitBoard x="15" y="15" size={28} className="text-green-400"/>
            <text x="15" y="60" fill="#e2e8f0" fontSize="22" fontWeight="bold">网口</text>
         </g>
      </g>
      
      {/* 右下：58所模块 */}
      <g id="institute-58" transform="translate(1080, 320)">
         <rect width="360" height="300" rx="6" fill="#1e293b" stroke="#a855f7" strokeWidth="3"/>
         <Cpu x="20" y="20" size={40} className="text-purple-400"/>
         <text x="70" y="50" fill="#e2e8f0" fontSize="24" fontWeight="bold">58所-模组</text>
         
         {/* 第一行：网口, 5G WiFi */}
         <g transform="translate(20, 80)">
            {/* 网口 */}
            <g transform="translate(0, 0)">
               <rect width="150" height="60" rx="6" fill="#0f172a" stroke="#10B981" strokeWidth="2"/>
               <CircuitBoard x="10" y="15" size={26} className="text-green-400"/>
               <text x="45" y="38" fill="#e2e8f0" fontSize="22" fontWeight="bold">网口</text>
            </g>
            {/* 5G WiFi */}
            <g transform="translate(170, 0)">
               <rect width="150" height="60" rx="6" fill="#0f172a" stroke="#3b82f6" strokeWidth="2"/>
               <Wifi x="10" y="15" size={26} className="text-blue-400"/>
               <text x="45" y="38" fill="#e2e8f0" fontSize="22" fontWeight="bold">5G/WiFi</text>
            </g>
         </g>

         {/* 第二行：RF, BLE */}
         <g transform="translate(20, 150)">
            {/* RF */}
            <g transform="translate(0, 0)">
               <rect width="150" height="60" rx="6" fill="#0f172a" stroke="#a855f7" strokeWidth="2"/>
               <Radio x="10" y="15" size={26} className="text-purple-400"/>
               <text x="45" y="38" fill="#e2e8f0" fontSize="22" fontWeight="bold">RF</text>
            </g>
            {/* BLE */}
            <g transform="translate(170, 0)">
               <rect width="150" height="60" rx="6" fill="#0f172a" stroke="#a855f7" strokeWidth="2"/>
               <Radio x="10" y="15" size={26} className="text-purple-400"/>
               <text x="45" y="38" fill="#e2e8f0" fontSize="22" fontWeight="bold">BLE</text>
            </g>
         </g>

         {/* 第三行：Sub1G */}
         <g transform="translate(20, 220)">
            <g transform="translate(0, 0)">
               <rect width="150" height="60" rx="6" fill="#0f172a" stroke="#a855f7" strokeWidth="2"/>
               <Radio x="10" y="15" size={26} className="text-purple-400"/>
               <text x="45" y="38" fill="#e2e8f0" fontSize="22" fontWeight="bold">Sub1G</text>
            </g>
         </g>
      </g>

      {/* ========== 左侧公网 ========== */}
      <g id="cloud-left" transform="translate(30, 400)">
         <Globe size={100} className="text-slate-400" x="0" y="0"/>
         <text x="48" y="120" textAnchor="middle" fill="#e2e8f0" fontSize="28" fontWeight="bold">公网</text>
      </g>
      
      

      {/* ========== 上方区域：云服务器 ========== */}
      <g id="cloud-servers" transform="translate(50, 0)">
         {/* 云服务器外框 */}
         <rect x="0" y="-200" width="800" height="330" rx="12" 
               fill="none" stroke="#10B981" strokeWidth="3" strokeDasharray="12 6" />
         <text x="20" y="-220" fill="#10B981" fontSize="35" fontWeight="bold">云服务器</text>
         
         <g transform="translate(220, -130)">
            <rect width="280" height="200" rx="8" fill="#1e293b" stroke="#22d3ee" strokeWidth="3"/>
            <Server x="35" y="35" size={54} className="text-cyan-400"/>
            <Database x="115" y="35" size={54} className="text-blue-400"/>
            <text x="40" y="115" fill="#e2e8f0" fontSize="26" fontWeight="bold">陆工大服务器</text>
            <text x="40" y="150" fill="#94a3b8" fontSize="22">网关设备状态</text>
            <text x="40" y="180" fill="#94a3b8" fontSize="22">业务场景</text>
            
         </g>
      </g>
      
      {/* ========== 大屏显示区域 ========== */}
      <g id="screen-displays" transform="translate(950, 0)">
         
         {/* 大屏部分 - 4个 */}
         <g transform="translate(190, -240)">
            <DisplayBox y={0} width={240} height={120} label="场景业务一" color="#22d3ee" fontSize={25}/>
            <DisplayBox y={145} width={240} height={120} label="场景业务二" color="#3b82f6" fontSize={25}/>
         </g>
         <g transform="translate(190, 50)">
            <DisplayBox y={0} width={240} height={120} label="场景业务三" color="#ef4444" active={fireStatus==='fire'} fontSize={25}/>
            
         </g>
      </g>

      {/* ========== 连线层 (顶层 - 前景) ========== */}
      <g id="connections-top">
         {/* 左侧传感器 -> 东大 5G WiFi */}
         <ConnectionLine startX={170} startY={1025} endX={820} endY={710} id="conn-cam-dongda" />
         <ConnectionLine startX={390} startY={1025} endX={820} endY={710} id="conn-temp1-dongda" />
         <ConnectionLine startX={610} startY={1025} endX={820} endY={710} id="conn-smoke-dongda" />

         {/* 右侧传感器 -> 58所 Sub1G */}
         <ConnectionLine startX={870} startY={1025} endX={1175} endY={600} id="conn-wind-58" />
         <ConnectionLine startX={1070} startY={1025} endX={1175} endY={600} id="conn-temp2-58" />

         {/* 右侧传感器 -> 58所 BLE */}
         <ConnectionLine startX={1270} startY={1025} endX={1345} endY={530} id="conn-light-58" />
         <ConnectionLine startX={1470} startY={1025} endX={1345} endY={530} id="conn-loud-58" />

         {/* 网口互联 (实线, 淡黄色) */}
         {/* 南邮网口 -> 东大网口 (从下进入) */}
         <ConnectionLine startX={405} startY={750} endX={750} endY={620} id="conn-nanjing-dongda" color="#FDE047" dashed={false} ballColor="#3b82f6" hasArrow={true} arrowId="arrow-pale-yellow" />
         {/* 宝通网口 -> 东大网口 (从左进入) */}
         <ConnectionLine startX={505} startY={475} endX={750} endY={580} id="conn-baotong-dongda" color="#FDE047" dashed={false} ballColor="#3b82f6" hasArrow={true} arrowId="arrow-pale-yellow" />
         {/* 58所网口 -> 东大网口 (从右进入) */}
         <ConnectionLine startX={1175} startY={430} endX={890} endY={580} id="conn-58-dongda" color="#FDE047" dashed={false} ballColor="#3b82f6" hasArrow={true} arrowId="arrow-pale-yellow" />

         {/* 南邮服务器 -> 场景业务 (淡黄色实线) */}
         <ConnectionLine startX={550} startY={-20} endX={1140} endY={-180} id="conn-nanjing-s1" color="#FDE047" dashed={false} ballColor="#3b82f6" hasArrow={true} arrowId="arrow-pale-yellow" />
         <ConnectionLine startX={550} startY={-20} endX={1140} endY={-35} id="conn-nanjing-s2" color="#FDE047" dashed={false} ballColor="#3b82f6" hasArrow={true} arrowId="arrow-pale-yellow" />
         <ConnectionLine startX={550} startY={-20} endX={1140} endY={110} id="conn-nanjing-s3" color="#FDE047" dashed={false} ballColor="#3b82f6" hasArrow={true} arrowId="arrow-pale-yellow" />
      </g>

    </svg>
  );
};

const SensorBox = ({ x, y, width=180, height=70, label, icon, color="#22d3ee", alert, fontSize=16 }) => (
  <g transform={`translate(${x}, ${y})`}>
    <rect width={width} height={height} rx="6" fill="#0f172a" stroke={alert ? '#ef4444' : color} strokeWidth={alert?3:2}/>
    <g transform="translate(12, 12)" className={alert?"text-red-500":"text-slate-400"} style={{color: alert?'red':color}}>
       {icon}
    </g>
    <text x={width/2} y={height/2 + 5} fill="#e2e8f0" fontSize={fontSize} fontWeight="bold" textAnchor="middle">{label}</text>
  </g>
);

const DisplayBox = ({ y, width=200, height=95, label, source, color, active, fontSize=16 }) => (
  <g transform={`translate(0, ${y})`}>
     <rect width={width} height={height} rx="6" fill="#0f172a" stroke={active?'#ef4444':color} strokeWidth={active?3:2} />
     <Monitor x="15" y="15" size={36} color={active?'#ef4444':color} />
     <text x={width/2} y={height/2 + 8} fill={active?'#ef4444':"#e2e8f0"} fontSize={fontSize} fontWeight="bold" textAnchor="middle">{label}</text>
  </g>
);

// --- 3. 初始化渲染 ---
const container = document.getElementById('topology-react-container');
if (container) {
    const root = ReactDOM.createRoot(container);
    root.render(<TopologyGraph />);
}

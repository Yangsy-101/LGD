<%@ page import="java.io.*, java.nio.file.*, java.util.*" %>
<%
    response.setContentType("application/json;charset=UTF-8");
    response.setHeader("Access-Control-Allow-Origin", "*");

    String basePath = application.getRealPath("/");
    String logFile = (basePath == null ? "/var/lib/tomcat/webapps/media/" : basePath) + "business_logs.txt";
    response.setHeader("X-Log-File", logFile);
    File f = new File(logFile);
    if (!f.exists()) {
        out.print("[]"); // 文件不存在返回空数组
        return;
    }
    
    try {
        // 读取所有日志行（去掉空行）
        List<String> rawLines = Files.readAllLines(f.toPath());
        List<String> lines = new ArrayList<String>();
        for (String l : rawLines) {
            if (l != null && l.trim().length() > 0) lines.add(l);
        }

        // 只取最新的 20 条记录（防止前端卡顿）
        int start = Math.max(0, lines.size() - 20);

        out.print("[");
        for (int i = lines.size() - 1; i >= start; i--) {
            out.print(lines.get(i));
            if (i > start) out.print(",");
        }
        out.print("]");
    } catch (Exception e) {
        response.setStatus(500);
        out.print("{\"error\":\"read failed\",\"message\":\"" + e.getMessage().replace("\"", "'") + "\"}");
    }
%>
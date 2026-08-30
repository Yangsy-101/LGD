<%@ page import="java.io.*, java.nio.file.*, java.nio.charset.StandardCharsets" %>
<%
    // 设置编码，防止中文乱码
    request.setCharacterEncoding("UTF-8");
    response.setContentType("text/plain;charset=UTF-8");
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
        response.setStatus(200);
        return;
    }
    
    // 读取 Python 发来的 JSON 数据体
    StringBuilder sb = new StringBuilder();
    BufferedReader reader = request.getReader();
    String line;
    while ((line = reader.readLine()) != null) {
        sb.append(line);
    }
    String jsonData = sb.toString();
    
    if (jsonData == null || jsonData.trim().isEmpty()) {
        response.setStatus(400);
        out.print("Empty Data");
        return;
    }

    String basePath = application.getRealPath("/");
    String logFile = (basePath == null ? "/var/lib/tomcat/webapps/media/" : basePath) + "business_logs.txt";
    response.setHeader("X-Log-File", logFile);
    try {
        Path logPath = Paths.get(logFile);
        Path parent = logPath.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }

        Files.write(
            logPath,
            (jsonData + "\n").getBytes(StandardCharsets.UTF_8),
            StandardOpenOption.CREATE,
            StandardOpenOption.WRITE,
            StandardOpenOption.APPEND
        );

        out.print("Log Saved OK: " + logPath.toString());
    } catch (Exception e) {
        response.setStatus(500);
        out.print("Log Save Failed: " + e.getMessage());
    }
%>
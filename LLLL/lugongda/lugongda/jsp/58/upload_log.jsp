<%@ page language="java" contentType="text/plain; charset=UTF-8" pageEncoding="UTF-8"%>
<%@ page import="java.io.*,java.text.*,java.util.*" %>
<%
    // 获取 Python 脚本传来的参数
    String source = request.getParameter("source");
    
    // 基础安全校验
    if(source == null || (!source.equals("58Suo") && !source.equals("NanYou") && !source.equals("BaoTong"))) {
        out.print("Error: Invalid source");
        return;
    }

    // 读取 POST Body 里的 JSON 字符串
    StringBuilder sb = new StringBuilder();
    BufferedReader reader = request.getReader();
    String line;
    while ((line = reader.readLine()) != null) {
        sb.append(line);
    }
    String payload = sb.toString().trim();

    if(payload.length() > 0) {
        // 仅保留时间戳用于区分写入的数据行
        String timeStr = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());

        // 根据 source 分配文件夹，例如应用根目录下的 logs/BaoTong/
        String savePath = application.getRealPath("/") + "logs/" + source;
        File dir = new File(savePath);
        if (!dir.exists()) {
            dir.mkdirs(); // 自动创建所需的文件夹
        }

        // 修改为固定文件名：data.txt，所有数据都会追加到这个文件中
        File logFile = new File(savePath, "data.txt");
        FileWriter fw = new FileWriter(logFile, true); // true 表示追加写入
        fw.write("[" + timeStr + "] " + payload + "\r\n");
        fw.close();

        out.print("Success");
    } else {
        out.print("Error: Empty payload");
    }
%>
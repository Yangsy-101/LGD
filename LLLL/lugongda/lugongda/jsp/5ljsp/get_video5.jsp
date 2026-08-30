<%@ page import="java.io.*" %><%
    response.setContentType("image/jpeg");
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    response.setHeader("Pragma", "no-cache");
    response.setDateHeader("Expires", 0);

    // 从全局内存变量中提取字节流
    byte[] imgBytes = (byte[]) application.getAttribute("ram_video_5");
    
    if (imgBytes != null && imgBytes.length > 0) {
        response.setContentLength(imgBytes.length);
        OutputStream os = response.getOutputStream();
        os.write(imgBytes);
        os.flush();
        out.clear();
        out = pageContext.pushBody();
    } else {
        response.setStatus(503);
    }
%>
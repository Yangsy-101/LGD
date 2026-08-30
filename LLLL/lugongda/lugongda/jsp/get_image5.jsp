<%@ page import="java.io.*" %><%
    // 强制声明这是一个动态的 JPEG 图片，并禁止浏览器和代理服务器缓存
    response.setContentType("image/jpeg");
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    response.setHeader("Pragma", "no-cache");
    response.setDateHeader("Expires", 0);

    String imgPath = "/var/lib/tomcat/webapps/media/video5/latest.jpg";
    File file = new File(imgPath);
    
    if(file.exists()){
        FileInputStream fis = new FileInputStream(file);
        OutputStream os = response.getOutputStream();
        byte[] buf = new byte[8192];
        int len;
        while((len = fis.read(buf)) != -1) {
            os.write(buf, 0, len);
        }
        fis.close();
        os.flush();
        
        // 清理 JSP 默认的字符输出流，防止与二进制图片流冲突报错
        out.clear();
        out = pageContext.pushBody();
    }
%>
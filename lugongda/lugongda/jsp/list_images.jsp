<%@ page import="java.io.*, java.util.*" %>
<%@ page contentType="application/json;charset=UTF-8" %>
<%
    // 允许前端跨域请求（方便你本地测试）
    response.setHeader("Access-Control-Allow-Origin", "*");
    
    // 获取前端想要查询的文件夹名字，默认查 snapshot1
    String folder = request.getParameter("folder");
    if(folder == null || folder.trim().isEmpty()) {
        folder = "snapshot1";
    }
    
    // 安全防御：防止黑客利用路径穿越漏洞去读系统的其他文件
    if(folder.contains("/") || folder.contains("\\") || folder.contains("..")) {
        out.print("[]");
        return;
    }

    String dirPath = "/var/lib/tomcat/webapps/media/" + folder;
    File dir = new File(dirPath);
    
    // 过滤出所有的 .jpg 文件
    File[] files = dir.listFiles(new FilenameFilter() {
        public boolean accept(File d, String name) {
            return name.toLowerCase().endsWith(".jpg");
        }
    });

    if(files == null || files.length == 0) {
        out.print("[]"); // 没找到图片，返回空数组
        return;
    }

    // 核心：按照文件的最后修改时间，倒序排列（最新的图片排在最前面）
    Arrays.sort(files, new Comparator<File>() {
        public int compare(File f1, File f2) {
            return Long.compare(f2.lastModified(), f1.lastModified());
        }
    });

    // 拼接成轻量级的 JSON 数组格式返回
    out.print("[");
    for(int i = 0; i < files.length; i++){
        out.print("\"" + files[i].getName() + "\"");
        if(i < files.length - 1) out.print(",");
    }
    out.print("]");
%>
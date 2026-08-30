<%@ page import="java.io.*, java.nio.file.*, java.text.SimpleDateFormat, java.util.Date" %>
<%
    request.setCharacterEncoding("UTF-8");
    response.setCharacterEncoding("UTF-8");
    response.setContentType("application/json;charset=UTF-8");
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "*");

    if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
        response.setStatus(200);
        out.print("{\"ok\":true}");
        return;
    }

    String baseDir = "/var/lib/tomcat/webapps/media/zjpic";
    int maxSnapshotBytes = 5 * 1024 * 1024;

    Files.createDirectories(Paths.get(baseDir));

    if (!"POST".equalsIgnoreCase(request.getMethod())) {
        response.setStatus(400);
        out.print("{\"ok\":false,\"message\":\"unsupported request, use POST\"}");
        return;
    }

    String uploadType = request.getHeader("X-Upload-Type");
    if (uploadType == null || uploadType.trim().length() == 0) {
        uploadType = "snapshot";
    }

    String ts = new SimpleDateFormat("yyyyMMdd-HHmmss-SSS").format(new Date());
    String fileName = request.getHeader("X-Filename");
    if (fileName == null || fileName.trim().length() == 0) {
        fileName = "PERSON_" + ts + ".jpg";
    }

    String tempPath = baseDir + "/temp_" + ts + ".jpg";
    String targetPath = baseDir + "/" + fileName;

    try {
        InputStream is = request.getInputStream();
        ByteArrayOutputStream baos = new ByteArrayOutputStream(Math.max(request.getContentLength(), 65536));
        byte[] buf = new byte[65536];
        int len;
        while ((len = is.read(buf)) > 0) {
            baos.write(buf, 0, len);
        }
        is.close();

        byte[] uploadBytes = baos.toByteArray();
        baos.close();

        if (uploadBytes.length <= 0) {
            response.setStatus(400);
            out.print("{\"ok\":false,\"message\":\"empty upload payload\"}");
            return;
        }

        if (uploadBytes.length > maxSnapshotBytes) {
            response.setStatus(413);
            out.print("{\"ok\":false,\"message\":\"upload payload too large\"}");
            return;
        }

        FileOutputStream fos = new FileOutputStream(tempPath);
        fos.write(uploadBytes);
        fos.close();

        Path source = Paths.get(tempPath);
        Path target = Paths.get(targetPath);
        try {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException ignore) {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
        }

        response.setStatus(200);
        String safePath = targetPath.replace("\\", "\\\\").replace("\"", "\\\"");
        out.print("{\"ok\":true,\"message\":\"upload success\",\"saved_path\":\"" + safePath + "\"}");
    } catch (Exception e) {
        response.setStatus(500);
        String msg = e.getMessage() == null ? "unknown error" : e.getMessage().replace("\\", "\\\\").replace("\"", "'");
        out.print("{\"ok\":false,\"message\":\"" + msg + "\"}");
    }
%>

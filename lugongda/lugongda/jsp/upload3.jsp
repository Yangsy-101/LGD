<%@ page import="java.io.*, java.nio.file.*, java.text.SimpleDateFormat, java.util.Date" %>
<%
    String baseDir = "/var/lib/tomcat/webapps/media";
    String uploadType = request.getHeader("X-Upload-Type");
    if (uploadType == null || uploadType.trim().length() == 0) {
        uploadType = "video";
    }

    String tempPath;
    String targetPath;

    try {
        if ("snapshot".equalsIgnoreCase(uploadType)) {
            String snapshotDir = baseDir + "/snapshot3";
            Files.createDirectories(Paths.get(snapshotDir));

            String fileName = request.getHeader("X-Filename");
            if (fileName == null || fileName.trim().length() == 0) {
                String ts = new SimpleDateFormat("yyyyMMdd-HHmmss-SSS").format(new Date());
                fileName = "SNAPSHOT_" + ts + ".jpg";
            }

            tempPath = snapshotDir + "/temp.jpg";
            targetPath = snapshotDir + "/" + fileName;
        } else {
            String videoDir = baseDir + "/video3";
            Files.createDirectories(Paths.get(videoDir));

            tempPath = videoDir + "/temp.jpg";
            targetPath = videoDir + "/latest.jpg";
        }

        InputStream is = request.getInputStream();
        FileOutputStream fos = new FileOutputStream(tempPath);

        byte[] buf = new byte[8192];
        int len;
        while ((len = is.read(buf)) > 0) {
            fos.write(buf, 0, len);
        }
        fos.close();
        is.close();

        Path source = Paths.get(tempPath);
        Path target = Paths.get(targetPath);
        Files.move(source, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);

        response.setStatus(200);
        out.print("OK: upload2 " + uploadType + " -> " + targetPath);

    } catch (Exception e) {
        response.setStatus(500);
        out.print("Error: " + e.getMessage());
    }
%>

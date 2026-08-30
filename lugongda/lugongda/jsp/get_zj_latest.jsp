<%@ page import="java.io.*, java.util.*" trimDirectiveWhitespaces="true" session="false" %><%
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Access-Control-Expose-Headers", "X-ZJ-Filename, X-ZJ-MTime, X-ZJ-Length");
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.setDateHeader("Expires", 0);

    if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
        response.setContentType("text/plain;charset=UTF-8");
        out.print("OK");
        return;
    }

    if (!"GET".equalsIgnoreCase(request.getMethod())) {
        response.setStatus(405);
        response.setContentType("text/plain;charset=UTF-8");
        out.print("Method Not Allowed");
        return;
    }

    long sinceMtime = -1L;
    try {
        String since = request.getParameter("since");
        if (since != null && since.trim().length() > 0) {
            sinceMtime = Long.parseLong(since.trim());
        }
    } catch (Exception ignore) {
        sinceMtime = -1L;
    }

    int waitMs = 0;
    try {
        String wait = request.getParameter("wait");
        if ("1".equals(wait) || "true".equalsIgnoreCase(wait)) {
            waitMs = 1200;
        }
        String timeout = request.getParameter("timeout");
        if (timeout != null && timeout.trim().length() > 0) {
            waitMs = Math.max(0, Math.min(3000, Integer.parseInt(timeout.trim())));
        }
    } catch (Exception ignore) {
        waitMs = 1200;
    }

    File dir = new File("/var/lib/tomcat/webapps/media/zjpic");
    FilenameFilter imageFilter = new FilenameFilter() {
        public boolean accept(File d, String name) {
            String lower = name.toLowerCase(Locale.ROOT);
            return lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png");
        }
    };

    File latest = null;
    long endAt = System.currentTimeMillis() + waitMs;
    do {
        File[] files = dir.listFiles(imageFilter);
        if (files != null && files.length > 0) {
            Arrays.sort(files, new Comparator<File>() {
                public int compare(File a, File b) {
                    int byTime = Long.compare(b.lastModified(), a.lastModified());
                    return byTime != 0 ? byTime : b.getName().compareTo(a.getName());
                }
            });
            latest = files[0];
            if (sinceMtime < 0 || latest.lastModified() > sinceMtime) {
                break;
            }
        }

        if (waitMs <= 0 || System.currentTimeMillis() >= endAt) {
            break;
        }
        try {
            Thread.sleep(Math.min(180L, endAt - System.currentTimeMillis()));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            break;
        }
    } while (true);

    if (latest == null || !latest.exists() || !latest.isFile()) {
        response.setStatus(404);
        response.setContentType("text/plain;charset=UTF-8");
        out.print("zjpic latest image not found");
        return;
    }

    if (sinceMtime >= 0 && latest.lastModified() <= sinceMtime) {
        response.setStatus(204);
        response.setHeader("X-ZJ-Filename", latest.getName());
        response.setHeader("X-ZJ-MTime", String.valueOf(latest.lastModified()));
        out.clear();
        out = pageContext.pushBody();
        return;
    }

    String lowerName = latest.getName().toLowerCase(Locale.ROOT);
    String contentType = lowerName.endsWith(".png") ? "image/png" : "image/jpeg";
    response.setContentType(contentType);
    response.setContentLength((int) latest.length());
    response.setHeader("X-ZJ-Filename", latest.getName());
    response.setHeader("X-ZJ-MTime", String.valueOf(latest.lastModified()));
    response.setHeader("X-ZJ-Length", String.valueOf(latest.length()));

    OutputStream os = response.getOutputStream();
    FileInputStream fis = new FileInputStream(latest);
    byte[] buf = new byte[65536];
    int len;
    while ((len = fis.read(buf)) != -1) {
        os.write(buf, 0, len);
    }
    fis.close();
    os.flush();

    out.clear();
    out = pageContext.pushBody();
%>

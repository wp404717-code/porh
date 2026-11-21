import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const swaggerPath = join(__dirname, "swagger.json");
import { getVideoDetails } from "./src/MediaDetails.js";
import { port } from "./src/constants.js";
import { getVideoSources } from "./src/Resolver.js";
import { getSearchResults } from "./src/Search.js";
import { getXhamsterVideo } from "./src/xhamster/XhamsterGet.js";
import { searchXhamster } from "./src/xhamster/XhamsterSearch.js";

const app = express();

app.disable("x-powered-by");
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
});
app.use(express.json({ limit: "1mb" }));

// ── Eporner response normalizers ──────────────────────────────────────────────

function normalizeEpornerVideo(details) {
    const embed = `https://www.eporner.com/embed/${details.id}/`;
    const image = details.default_thumb?.src || 'None';
    const tags = details.keywords
        ? details.keywords.split(',').map(t => t.trim()).filter(Boolean)
        : [];
    const sources = Object.values(details.sources?.mp4 || {}).map(s => ({
        quality: s.labelShort,
        url: s.src,
    }));
    return {
        success: true,
        data: {
            title: details.title || 'None',
            id: details.id || 'None',
            image,
            duration: details.length_min || 'None',
            views: details.views?.toString() || 'None',
            rating: details.rate || 'None',
            uploaded: details.added || 'None',
            tags,
            source: embed,
            sources,
        },
    };
}

function normalizeEpornerSearchResult(searchDetails) {
    const videos = (searchDetails.videos || []).map(v => ({
        link: v.url || 'None',
        id: v.id || 'None',
        title: v.title || 'None',
        image: v.default_thumb?.src || 'None',
        duration: v.length_min || 'None',
        views: v.views?.toString() || 'None',
        video: v.embed || `https://www.eporner.com/embed/${v.id}/`,
    }));
    return {
        success: true,
        data: videos,
        page: searchDetails.page,
        total_pages: searchDetails.total_pages,
        total_count: searchDetails.total_count,
    };
}

app.get('/swagger.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(readFileSync(swaggerPath, "utf8"));
});

app.get('/docs', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/swagger.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true
    });
  </script>
</body>
</html>`);
});

app.get('/', (req, res) => {
    res.status(200).json({
        intro: "Welcome to this unofficial multi-provider adult API.",
        NOTE: "Due to restrictions in countries like the UK this api's sources may not work unless requests come from a country like germany so a proxy would be advisable!.",
        providers: {
            eporner: {
                search: "/api/eporner/search/:query",
                details_and_sources: "/api/eporner/details/:id",
            },
            xhamster: {
                search: "/api/xhamster/search/:query",
                details_and_sources: "/api/xhamster/details/:id",
            },
        },
        author: "This api is developed and created by Inside4ndroid"
    });
});

// ── Eporner routes ────────────────────────────────────────────────────────────

app.get('/api/eporner/details/:id', async (req, res) => {
    const id = req.params.id || null;
    const thumbsize = req.query.thumbsize || 'medium';

    try {
    const getDetails = await getVideoDetails(id, thumbsize);
    const getSources = await getVideoSources(id);

    if (!getDetails?.json?.details || !getSources) {
        res.status(404).send({
            status: 404,
            return: "Oops reached rate limit of this api"
        });
    } else {
        getDetails.json.details.sources = getSources.sources;
        res.status(200).json(normalizeEpornerVideo(getDetails.json.details));
    }
    } catch (error) {
        console.error('Eporner details route error:', error);
        res.status(502).json({ success: false, error: 'Upstream provider request failed' });
    }
});

app.get('/api/eporner/search/:query', async (req, res) => {
    const query = req.params.query;
    const per_page = req.query.per_page || '30';
    const page = req.query.page || '1';
    const thumbsize = req.query.thumbsize || 'medium';
    const order = req.query.order || 'latest';
    const gay = req.query.gay || '0';
    const lq = req.query.lq || '1';
    try {
    const getResults = await getSearchResults(query, per_page, page, thumbsize, order, gay, lq);
    if (!getResults?.json?.details) {
        res.status(404).send({ status: 404, return: "Oops reached rate limit of this api" });
    } else {
        res.status(200).json(normalizeEpornerSearchResult(getResults.json.details));
    }
    } catch (error) {
        console.error('Eporner search route error:', error);
        res.status(502).json({ success: false, error: 'Upstream provider request failed' });
    }
});

// ── XHamster routes ───────────────────────────────────────────────────────────

app.get('/api/xhamster/details/:id', async (req, res) => {
    const id = req.params.id;
    const result = await getXhamsterVideo(id);
    if (result === null) {
        res.status(404).send({ status: 404, return: "Video not found or failed to scrape" });
    } else {
        res.status(200).json(result);
    }
});

app.get('/api/xhamster/search/:query', async (req, res) => {
    const query = req.params.query;
    const page = req.query.page || '1';
    const result = await searchXhamster(query, page);
    if (result === null) {
        res.status(404).send({ status: 404, return: "No results found" });
    } else {
        res.status(200).json(result);
    }
});

app.use((err, req, res, next) => {
    console.error('Unhandled API error:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// Vercel serverless: export the Express app
export default app;

// Local development only
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Local server: http://localhost:${port}`);
  });
}
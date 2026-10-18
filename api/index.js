
import express from 'express';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { randomUUID } from 'node:crypto';

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration de la collecte des logs
const LOG_API_URL = process.env.LOG_API_URL;
const LOG_API_TOKEN = process.env.LOG_API_TOKEN;

// Facultatif : liste des domaines autorisés pour les captures.
// Exemple : ALLOWED_TARGET_HOSTS=app.example.com,staging.example.com
const ALLOWED_TARGET_HOSTS = (process.env.ALLOWED_TARGET_HOSTS || '')
  .split(',')
  .map(host => host.trim().toLowerCase())
  .filter(Boolean);

app.use(express.json({ limit: '10mb' }));

// Évite de journaliser les corps de requêtes, cookies et tokens.
function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';

    // Les paramètres peuvent contenir des données sensibles.
    // On les masque par défaut dans les logs.
    if (url.search) url.search = '?[REDACTED]';

    return url.toString();
  } catch {
    return '[URL_INVALID_OR_UNAVAILABLE]';
  }
}

function errorDetails(error) {
  if (!error) return {};

  return {
    name: error.name || 'Error',
    message: String(error.message || error).slice(0, 4000),
    stack: typeof error.stack === 'string'
      ? error.stack.slice(0, 8000)
      : undefined,
  };
}

function isAllowedTarget(value) {
  let target;

  try {
    target = new URL(value);
  } catch {
    return { allowed: false, reason: 'URL invalide' };
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    return {
      allowed: false,
      reason: 'Seuls les protocoles HTTP et HTTPS sont autorisés',
    };
  }

  if (target.username || target.password) {
    return {
      allowed: false,
      reason: 'Les identifiants intégrés dans l’URL sont interdits',
    };
  }

  // if (
  //   ALLOWED_TARGET_HOSTS.length > 0 &&
  //   !ALLOWED_TARGET_HOSTS.includes(target.hostname.toLowerCase())
  // ) {
  //   return {
  //     allowed: false,
  //     reason: 'Domaine absent de ALLOWED_TARGET_HOSTS',
  //   };
  // }

  return { allowed: true, url: target };
}

// Envoi indépendant : l'indisponibilité du collecteur ne doit pas
// empêcher la génération du PDF.
async function sendLogs(payload) {
  // if (!LOG_API_URL) {
  //   console.warn(
  //     '[LOG COLLECTOR] LOG_API_URL non configurée ; logs conservés uniquement en mémoire pendant la requête.'
  //   );
  //   return { sent: false, reason: 'LOG_API_URL non configurée' };
  // }

  let endpoint;

  try {
    endpoint = new URL("https://universchool.danielassani.com/api/logging");
    if (!['http:', 'https:'].includes(endpoint.protocol)) {
      throw new Error('Protocole API non autorisé');
    }
  } catch (error) {
    console.error('[LOG COLLECTOR] URL API invalide :', error.message);
    return { sent: false, reason: 'URL API invalide' };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(LOG_API_TOKEN
          ? { Authorization: `Bearer ${LOG_API_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(
        `[LOG COLLECTOR] Échec HTTP ${response.status} lors de l'envoi`
      );

      return {
        sent: false,
        status: response.status,
      };
    }

    console.log('[LOG COLLECTOR] Logs transmis avec succès');

    return {
      sent: true,
      status: response.status,
    };
  } catch (error) {
    console.error('[LOG COLLECTOR] Erreur d’envoi :', error.message);

    return {
      sent: false,
      reason: error.message,
    };
  }
}

app.get('/', (_req, res) => {
  res.json({
    service: 'Puppeteer PDF Generator',
    status: 'operational',
    logCollectorConfigured: Boolean(LOG_API_URL),
  });
});

app.post('/', async (req, res) => {
  const correlationId = randomUUID();
  const startedAt = Date.now();
  const logs = [];
  const requestTimings = new WeakMap();

  let browser = null;
  let page = null;
  let pdf = null;
  let httpStatus = 200;
  let failure = null;
  let targetUrl = null;
  let finalUrl = null;
  let navigationStatus = null;
  let pdfDurationMs = null;
  let domDebug = null;

  const emit = (level, event, details = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      correlationId,
      level,
      event,
      details,
    };

    logs.push(entry);

    // Affichage local également, utile sur les plateformes cloud.
    const output = JSON.stringify(entry);
    if (level === 'error') console.error(output);
    else if (level === 'warn') console.warn(output);
    else console.log(output);
  };

  const { url } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      error: 'URL manquante ou invalide',
      correlationId,
    });
  }

  const validation = isAllowedTarget(url);

  if (!validation.allowed) {
    return res.status(400).json({
      error: validation.reason,
      correlationId,
    });
  }

  targetUrl = sanitizeUrl(validation.url.href);
  //update

  emit('info', 'request.received', {
    method: req.method,
    targetUrl,
    userAgent: req.get('user-agent') || null,
  });

  try {
    chromium.setGraphicsMode = true;

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
      ],
      defaultViewport: { width: 1280, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    browser.on('disconnected', () => {
      emit('error', 'browser.disconnected');
    });

    page = await browser.newPage();

    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);

    // Ne pas transférer automatiquement les cookies ou les tokens.
    await page.setCacheEnabled(false);

    page.on('console', msg => {
      const location = msg.location();

      emit(
        msg.type() === 'error'
          ? 'error'
          : msg.type() === 'warning'
            ? 'warn'
            : 'info',
        'browser.console',
        {
          type: msg.type(),
          text: msg.text().slice(0, 4000),
          location: {
            url: location.url ? sanitizeUrl(location.url) : null,
            lineNumber: location.lineNumber,
            columnNumber: location.columnNumber,
          },
        }
      );
    });

    page.on('pageerror', error => {
      emit('error', 'browser.pageerror', errorDetails(error));
    });

    page.on('error', error => {
      emit('error', 'browser.error', errorDetails(error));
    });

    page.on('request', request => {
      requestTimings.set(request, Date.now());

      emit('debug', 'network.request', {
        url: sanitizeUrl(request.url()),
        method: request.method(),
        resourceType: request.resourceType(),
      });
    });

    page.on('response', response => {
      const request = response.request();
      const started = requestTimings.get(request);

      emit(
        response.status() >= 400 ? 'error' : 'info',
        'network.response',
        {
          url: sanitizeUrl(response.url()),
          method: request.method(),
          status: response.status(),
          statusText: response.statusText(),
          resourceType: request.resourceType(),
          durationMs: started ? Date.now() - started : null,
        }
      );
    });

    page.on('requestfailed', request => {
      emit('error', 'network.requestfailed', {
        url: sanitizeUrl(request.url()),
        method: request.method(),
        resourceType: request.resourceType(),
        failure: request.failure()?.errorText || 'Cause inconnue',
      });
    });

    page.on('requestfinished', request => {
      const started = requestTimings.get(request);

      emit('debug', 'network.requestfinished', {
        url: sanitizeUrl(request.url()),
        method: request.method(),
        durationMs: started ? Date.now() - started : null,
      });
    });

    page.on('domcontentloaded', () => {
      emit('info', 'page.domcontentloaded', {
        url: sanitizeUrl(page.url()),
      });
    });

    page.on('load', () => {
      emit('info', 'page.load', {
        url: sanitizeUrl(page.url()),
      });
    });

    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        emit('info', 'page.navigation', {
          url: sanitizeUrl(frame.url()),
        });
      }
    });

    emit('info', 'browser.launched');

    // Navigation principale
    const navigationStarted = Date.now();

    const response = await page.goto(validation.url.href, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    const navigationDurationMs = Date.now() - navigationStarted;

    navigationStatus = response ? response.status() : null;
    finalUrl = sanitizeUrl(page.url());

    emit(
      navigationStatus >= 400 ? 'error' : 'info',
      'page.navigation.completed',
      {
        status: navigationStatus,
        finalUrl,
        durationMs: navigationDurationMs,
      }
    );

    // État du DOM et indices utiles pour React / Inertia / Vite
    domDebug = await page.evaluate(() => {
      const appElement = document.querySelector('#app');
      const body = document.body;

      return {
        title: document.title,
        readyState: document.readyState,
        appExists: Boolean(appElement),
        appHasContent: Boolean(
          appElement && appElement.innerHTML.trim().length > 0
        ),
        appChildCount: appElement?.children.length ?? 0,
        appTextLength: appElement?.innerText?.length ?? 0,
        bodyTextLength: body?.innerText?.length ?? 0,
        bodyHtmlSnippet: body?.innerHTML.slice(0, 1000) ?? '',
        pdfReady: window.__PDF_READY__ === true,
        location: location.href.split('?')[0],
      };
    });

    emit('info', 'page.dom.diagnostics', domDebug);

    // Attendre le montage de React si le conteneur est présent.
    try {
      await page.waitForSelector('#app > *', { timeout: 10000 });
      emit('info', 'react.mount.detected');
    } catch (error) {
      emit('warn', 'react.mount.timeout', errorDetails(error));
    }

    // Attendre le signal personnalisé de l'application.
    try {
      await page.waitForFunction(
        () => window.__PDF_READY__ === true,
        { timeout: 10000 }
      );

      emit('info', 'pdf.ready.flag.detected');
    } catch (error) {
      emit('warn', 'pdf.ready.flag.timeout', {
        message: error.message,
        fallback: 'Capture PDF poursuivie sans le signal de préparation',
      });
    }

    // Mesures supplémentaires avant la capture.
    const metrics = await page.metrics();

    emit('info', 'page.metrics', {
      jsHeapUsedSize: metrics.JSHeapUsedSize,
      jsHeapTotalSize: metrics.JSHeapTotalSize,
      nodes: metrics.Nodes,
      documents: metrics.Documents,
      frames: metrics.Frames,
      taskDuration: metrics.TaskDuration,
    });

    const pdfStarted = Date.now();

    pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });

    pdfDurationMs = Date.now() - pdfStarted;

    emit('info', 'pdf.generated', {
      durationMs: pdfDurationMs,
      sizeBytes: pdf.length,
      finalUrl,
    });
  } catch (error) {
    httpStatus = 500;
    failure = errorDetails(error);

    emit('error', 'capture.failed', failure);
  } finally {
    if (browser) {
      try {
        await browser.close();
        emit('info', 'browser.closed');
      } catch (error) {
        emit('error', 'browser.close.failed', errorDetails(error));
      }
    }

    emit('info', 'request.completed', {
      durationMs: Date.now() - startedAt,
      logCount: logs.length,
      success: Boolean(pdf && !failure),
    });

    // On transmet le rapport après fermeture du navigateur.
    // Un échec de l'API de logs ne bloque pas la réponse PDF.
    const report = {
      schemaVersion: 1,
      correlationId,
      service: 'puppeteer-pdf-generator',
      timestamp: new Date().toISOString(),
      outcome: pdf && !failure ? 'success' : 'failure',
      request: {
        method: req.method,
        targetUrl,
      },
      navigation: {
        finalUrl,
        status: navigationStatus,
      },
      diagnostics: domDebug,
      pdf: pdf
        ? {
            sizeBytes: pdf.length,
            durationMs: pdfDurationMs,
          }
        : null,
      durationMs: Date.now() - startedAt,
      error: failure,
      logCount: logs.length,
      logs,
    };

    const delivery = await sendLogs(report);

    emit('info', 'logs.delivery.result', delivery);
  }

  // Réponse HTTP finale
  if (pdf && !failure) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader(
      'Content-Disposition',
      'inline; filename="document.pdf"'
    );
    res.setHeader('X-Correlation-ID', correlationId);

    return res.status(200).end(pdf);
  }

  return res.status(httpStatus).json({
    error: failure?.message || 'Échec de la génération du PDF',
    correlationId,
    finalUrl,
    navigationStatus,
  });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(
      `Microservice PDF actif sur http://localhost:${PORT}`
    );
  });
}

export default app;

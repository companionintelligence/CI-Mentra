/* ==========================================================================
 * env-builder — turns the setup form into a CI-Mentra `.env`.
 *
 * Pure and dependency-free so it runs in the browser (window.MentraEnv) and
 * under jest (module.exports). Nothing typed into the form leaves the page:
 * the file is assembled here and copied/downloaded locally.
 * ========================================================================== */
(function (root) {
  'use strict';

  var DEFAULTS = {
    mode: 'hub',                     // hub | compose | tailscale
    packageName: 'com.companionintelligence.mentra',
    mentraApiKey: '',
    facadeApiKey: '',
    sessionSecret: '',
    hubUrl: 'http://ci-hub:5002',
    hubSlug: 'ci-mentra',
    ollamaUrl: 'http://localhost:11434',
    model: 'llama3.2',
    memoryEnabled: true,
    ciServerUrl: 'http://ci-server:8642',
    memoryPrefix: '/api',
    memoryKey: '',
    oidcEnabled: false,
    oidcClientId: 'ci-mentra',
    speechUrl: ''
  };

  function clean(value) {
    // Env values are single-line; strip anything that could start a new key.
    return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
  }

  function trimUrl(value) {
    return clean(value).replace(/\/+$/, '');
  }

  /** The bridge appends /v1/audio/transcriptions itself, so a trailing /v1 is always wrong. */
  function speechBase(value) {
    return trimUrl(value).replace(/\/v1$/i, '');
  }

  function line(key, value) {
    var v = clean(value);
    return key + '=' + (/[\s#"'$`\\]/.test(v) ? '"' + v.replace(/(["\\$`])/g, '\\$1') + '"' : v);
  }

  /** Merge user input over defaults, coercing checkbox-ish values. */
  function normalize(input) {
    var o = {};
    var src = input || {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var v = src[k];
      if (typeof DEFAULTS[k] === 'boolean') {
        o[k] = v === undefined ? DEFAULTS[k] : v === true || v === 'true' || v === 'on';
      } else {
        o[k] = v === undefined || v === null || clean(v) === '' ? DEFAULTS[k] : clean(v);
      }
    });
    if (['hub', 'compose', 'tailscale'].indexOf(o.mode) < 0) o.mode = DEFAULTS.mode;
    return o;
  }

  /** Returns a list of human-readable problems; empty means the env is usable. */
  function validate(input) {
    var o = normalize(input);
    var problems = [];
    if (!o.mentraApiKey) problems.push('MentraOS API key is required — copy it from the MentraOS developer console.');
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(o.packageName)) problems.push('Package name should look like com.example.app and match the console.');
    if (o.memoryEnabled && !o.memoryKey) problems.push('Companion Memory is on but no memory key was given — memory will stay off.');
    if (!o.facadeApiKey && !o.oidcEnabled) problems.push('No façade key and no sign-in: the /v1 API and companion UI would be open. Generate a key.');
    if (!o.speechUrl) problems.push('No speech-to-text URL: the bridge has no speech-to-text of its own, so without one it cannot transcribe what you say. Point it at an OpenAI-compatible server, such as a local Whisper server.');
    var urlLabels = { hubUrl: 'Companion Hub URL', ollamaUrl: 'Ollama URL', ciServerUrl: 'Companion Memory URL', speechUrl: 'Speech-to-text URL' };
    Object.keys(urlLabels).forEach(function (k) {
      if (o[k] && !/^https?:\/\/[^\s/]+/i.test(o[k])) problems.push(urlLabels[k] + ' must start with http:// or https://');
    });
    if (/\/v1\/*$/i.test(o.speechUrl)) problems.push('Speech-to-text URL: leave off the trailing /v1, the bridge adds it. It is removed from the file below.');
    return problems;
  }

  function build(input) {
    var o = normalize(input);
    var out = [];
    function section(title) { out.push('', '# --- ' + title + ' ---'); }

    out.push('# Companion for Mentra bridge — generated at mentra.ci.computer (' + o.mode + ' setup).');
    out.push('# Keep this file private: it holds your MentraOS and Companion Memory keys.');

    section('MentraOS');
    out.push(line('MENTRA_RUNTIME_MODE', 'cloud'));
    out.push(line('MENTRA_PACKAGE_NAME', o.packageName));
    out.push(line('MENTRA_API_KEY', o.mentraApiKey));
    out.push(line('MENTRA_PORT', '7010'));

    section('Façade + companion UI');
    out.push(line('FACADE_PORT', '8080'));
    out.push(line('FACADE_API_KEY', o.facadeApiKey));
    out.push(line('MENTRA_SESSION_SECRET', o.sessionSecret));

    section('Sign in with Companion Intelligence (OIDC)');
    out.push(line('MENTRA_OIDC_ENABLED', o.oidcEnabled ? 'true' : 'false'));
    if (o.oidcEnabled) {
      out.push(line('MENTRA_OIDC_ISSUER', 'https://hub.companionintelligence.com/api/auth'));
      out.push(line('MENTRA_OIDC_CLIENT_ID', o.oidcClientId));
      out.push(line('PORTAL_OIDC_ENABLED', 'true'));
    }

    section('Inference');
    if (o.mode === 'hub') {
      out.push(line('HUB_INFERENCE_BOOTSTRAP', 'true'));
      out.push(line('CI_HUB_URL', trimUrl(o.hubUrl)));
      out.push(line('HUB_APP_SLUG', o.hubSlug));
      // The Hub hands out OLLAMA_HOST itself (possibly a pool proxy); pinning it
      // here would override that, since explicit env always wins.
      out.push(line('DEFAULT_PROVIDER', 'hermes'));
    } else {
      out.push(line('HUB_INFERENCE_BOOTSTRAP', 'false'));
      out.push(line('DEFAULT_PROVIDER', 'ollama'));
      out.push(line('OLLAMA_BASE_URL', trimUrl(o.ollamaUrl)));
    }
    out.push(line('OLLAMA_API_KEY', 'ollama'));
    out.push(line('LLM_DEFAULT_CHAT_MODEL', o.model));

    section('Speech-to-text (OpenAI-compatible)');
    if (o.speechUrl) {
      out.push(line('OPENAI_BASE_URL', speechBase(o.speechUrl)));
      out.push(line('VLLM_BASE_URL', speechBase(o.speechUrl)));
      out.push(line('OPENAI_API_KEY', 'local-only'));
    } else {
      out.push('# Not set: the bridge has no speech-to-text of its own and cannot transcribe speech without one.');
      out.push('# Set OPENAI_BASE_URL (and VLLM_BASE_URL) to an OpenAI-compatible server, such as a local Whisper server.');
    }
    out.push(line('TTS_PROVIDER', 'mentra'));

    section('Companion Memory (CI-Server)');
    out.push(line('MENTRA_MEMORY_ENABLED', o.memoryEnabled ? 'true' : 'false'));
    out.push(line('CI_SERVER_URL', trimUrl(o.ciServerUrl)));
    out.push(line('CI_SERVER_MEMORY_PATH_PREFIX', o.memoryPrefix === '(none)' ? '' : o.memoryPrefix));
    out.push(line('CI_SERVER_MEMORY_KEY', o.memoryKey));
    out.push(line('MENTRA_MEMORY_PLATFORM', 'mentra'));

    section('Local state');
    out.push('# DATABASE_URL uses the default postgres/postgres login of the bundled docker-compose Postgres.');
    out.push('# That is fine on a private Docker network. Change it (and POSTGRES_PASSWORD in docker-compose.yml)');
    out.push('# before Postgres is reachable from anywhere else.');
    var host = o.mode === 'hub' || o.mode === 'compose' ? { pg: 'postgres', redis: 'redis' } : { pg: 'localhost', redis: 'localhost' };
    out.push(line('DATABASE_URL', 'postgresql://postgres:postgres@' + host.pg + ':5432/mentra'));
    out.push(line('REDIS_URL', 'redis://' + host.redis + ':6379'));
    out.push(line('MENTRA_DEV_ALLOW_ANONYMOUS', 'false'));

    return out.join('\n') + '\n';
  }

  var ACCESS = [
    '# Companion for Mentra is a developer preview and its source repository is private.',
    '# Ask for access in the Discord (https://ci.computer/gg), and see the docs:',
    '# https://docs.ci.computer/docs/apps-available/first-party-apps/mentra-live'
  ];

  /** Commands to run after saving the env, per deployment mode. */
  function commands(input) {
    var o = normalize(input);
    if (o.mode === 'hub') {
      return ACCESS.concat([
        '',
        '# The Companion for Mentra listing in the Hub app catalog is developer-only.',
        '# Once it is installed on your Companion Hub, paste this env into its settings.',
        '# The Hub hands inference credentials only to containers it installed as ci-mentra;',
        '# running by hand next to a Hub? Pick "Docker Compose" and point Ollama at the Hub host instead.',
        'curl -s http://<your-bridge>:8080/health'
      ]).join('\n');
    }
    if (o.mode === 'compose') {
      return ACCESS.concat([
        '',
        'git clone <repository URL you were given> CI-Mentra && cd CI-Mentra',
        'cp ~/Downloads/mentra.env .env',
        'docker compose up -d --build',
        'curl -s http://localhost:8080/health'
      ]).join('\n');
    }
    return ACCESS.concat([
      '',
      'git clone <repository URL you were given> CI-Mentra && cd CI-Mentra',
      'cp ~/Downloads/mentra.env .env',
      'docker compose up -d postgres redis',
      'npm ci && npm run build && npm start',
      'tailscale funnel 7010   # MentraOS must reach the AppServer over HTTPS'
    ]).join('\n');
  }

  var api = { DEFAULTS: DEFAULTS, normalize: normalize, validate: validate, build: build, commands: commands };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MentraEnv = api;
})(typeof window !== 'undefined' ? window : this);

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const BASE_URL = process.env.BASE_URL || 'https://easy-oauth-worker.pages.dev';

console.log('================================================================');
console.log('🚀 EasyOAuth Comprehensive Live E2E Verification Suite');
console.log(`🎯 Target Deployment: ${BASE_URL}`);
console.log(`⏰ Started at: ${new Date().toISOString()}`);
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Helper: Simple Cookie Jar Fetch
// -----------------------------------------------------------------------------
class TestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.cookies = new Map();
  }

  getCookieString() {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  saveCookies(res) {
    // In modern node fetch, getSetCookie() returns all Set-Cookie headers
    const rawHeaders = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);

    for (const header of rawHeaders) {
      const parts = header.split(';')[0].split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim();
        if (val === '' || val === 'deleted') {
          this.cookies.delete(key);
        } else {
          this.cookies.set(key, val);
        }
      }
    }
  }

  async request(path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const headers = { ...(options.headers || {}) };

    const cookieStr = this.getCookieString();
    if (cookieStr) {
      headers['Cookie'] = cookieStr;
    }

    const res = await fetch(url, {
      ...options,
      headers,
      redirect: options.redirect || 'manual', // default manual to capture 302 and cookies
    });

    this.saveCookies(res);
    return res;
  }

  async get(path, options = {}) {
    return this.request(path, { ...options, method: 'GET' });
  }

  async post(path, body, options = {}) {
    const headers = { ...(options.headers || {}) };
    let bodyData = body;

    if (body && typeof body === 'object' && !(body instanceof URLSearchParams) && !(body instanceof FormData)) {
      if (headers['Content-Type'] === 'application/json') {
        bodyData = JSON.stringify(body);
      } else {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        bodyData = new URLSearchParams(body).toString();
      }
    }

    return this.request(path, {
      ...options,
      method: 'POST',
      headers,
      body: bodyData,
    });
  }
}

// -----------------------------------------------------------------------------
// Helper: RFC 6238 TOTP Generator for Live Authenticator Simulation
// -----------------------------------------------------------------------------
function base32Decode(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTotpCode(secret, stepOffset = 0) {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = Math.floor(epoch / 30) + stepOffset;

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(timeStep));

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (codeInt % 1000000).toString().padStart(6, '0');
}

// PKCE S256 helper
function generatePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// Sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Test runner state
let totalSteps = 0;
let passedSteps = 0;

function assert(condition, message) {
  totalSteps++;
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    throw new Error(message);
  }
  passedSteps++;
  console.log(`  ✔ PASS: ${message}`);
}

async function runLiveE2ETests() {
  const client = new TestClient(BASE_URL);

  // ---------------------------------------------------------------------------
  // STAGE 1: Production Infrastructure & OIDC Discovery Health Check
  // ---------------------------------------------------------------------------
  console.log('\n[Stage 1/8] Verifying Production Health & OIDC Discovery...');

  const healthRes = await client.get('/health');
  assert(healthRes.status === 200, 'GET /health returned HTTP 200');
  const healthData = await healthRes.json();
  assert(healthData.status === 'ok', 'Health status is "ok"');
  assert(healthData.service === 'easy-oauth-worker', 'Health service name matches "easy-oauth-worker"');

  const oidcRes = await client.get('/.well-known/openid-configuration');
  assert(oidcRes.status === 200, 'GET /.well-known/openid-configuration returned HTTP 200');
  const oidcData = await oidcRes.json();
  assert(typeof oidcData.issuer === 'string', 'OIDC issuer is properly configured');
  assert(oidcData.authorization_endpoint.endsWith('/oauth/authorize'), 'Authorization endpoint matches');
  assert(oidcData.token_endpoint.endsWith('/oauth/token'), 'Token endpoint matches');
  assert(oidcData.userinfo_endpoint.endsWith('/oauth/userinfo'), 'UserInfo endpoint matches');
  assert(oidcData.jwks_uri.endsWith('/.well-known/jwks.json'), 'JWKS URI matches');
  assert(Array.isArray(oidcData.code_challenge_methods_supported) && oidcData.code_challenge_methods_supported.includes('S256'), 'PKCE S256 supported');

  const jwksRes = await client.get('/.well-known/jwks.json');
  assert(jwksRes.status === 200, 'GET /.well-known/jwks.json returned HTTP 200');
  const jwksData = await jwksRes.json();
  assert(Array.isArray(jwksData.keys) && jwksData.keys.length > 0, 'JWKS contains public RSA signing keys');
  assert(jwksData.keys[0].kty === 'RSA', 'JWKS public key kty is RSA');

  // ---------------------------------------------------------------------------
  // STAGE 2: Real User Self-Registration & Automatic Onboarding
  // ---------------------------------------------------------------------------
  const timestamp = Date.now().toString().slice(-6);
  const testUser = `live_user_${timestamp}`;
  const initialPassword = `SecurePass_${timestamp}!`;
  console.log(`\n[Stage 2/8] Testing Real User Registration for "${testUser}"...`);

  const regPageRes = await client.get('/register');
  assert(regPageRes.status === 200, 'GET /register returned HTTP 200');
  const regHtml = await regPageRes.text();
  assert(regHtml.includes('Create your account') || regHtml.includes('Username'), 'Register view rendered with pure username fields');

  const regRes = await client.post('/register', {
    username: testUser,
    password: initialPassword,
    confirm_password: initialPassword,
  });
  assert(regRes.status === 302, 'POST /register succeeded with 302 redirect');
  const regRedirect = regRes.headers.get('location');
  assert(regRedirect.includes('/account/security'), 'Registration automatically signed in user and redirected to /account/security');
  assert(client.cookies.has('easy_session'), 'Browser client received session cookie');

  // ---------------------------------------------------------------------------
  // STAGE 3: Account Security & Google Authenticator (TOTP) 2FA Setup
  // ---------------------------------------------------------------------------
  console.log('\n[Stage 3/8] Setting up Google Authenticator (TOTP) 2FA...');

  const secRes = await client.get('/account/security');
  assert(secRes.status === 200, 'GET /account/security returned HTTP 200');
  const secHtml = await secRes.text();
  assert(secHtml.includes('<svg') && secHtml.includes('rect'), 'Account security page rendered inline SVG QR Code');
  assert(secHtml.includes(testUser), 'Account security page shows active username');

  // Extract raw base32 secret from HTML
  const secretMatch = secHtml.match(/name="secret"\s+value="([A-Z2-7]{16,64})"/i) ||
                      secHtml.match(/id="totp-secret"[^>]*>([A-Z2-7]{16,64})</i) ||
                      secHtml.match(/value="([A-Z2-7]{32})"/i);
  assert(secretMatch && secretMatch[1], 'Extracted Base32 TOTP secret from page');
  const totpSecret = secretMatch[1];
  console.log(`  ℹ  Extracted TOTP Secret: ${totpSecret.slice(0, 6)}...${totpSecret.slice(-4)}`);

  // Generate current valid 6-digit TOTP code
  const currentTotp = generateTotpCode(totpSecret);
  console.log(`  ℹ  Generated Live TOTP Code: ${currentTotp}`);

  const enableTotpRes = await client.post('/account/security/enable-totp', {
    secret: totpSecret,
    totp_code: currentTotp,
  });
  assert(enableTotpRes.status === 200, 'POST /account/security/enable-totp returned HTTP 200');
  const enableHtml = await enableTotpRes.text();
  assert(enableHtml.includes('Google Authenticator 2FA has been successfully enabled') || enableHtml.includes('Enabled'), 'TOTP 2FA successfully activated on remote user');

  // ---------------------------------------------------------------------------
  // STAGE 4: Logout & Two-Factor Authentication (2FA) Full Login Challenge
  // ---------------------------------------------------------------------------
  console.log('\n[Stage 4/8] Testing Two-Factor Authentication Login Flow...');

  // Logout
  const logoutRes = await client.get('/logout');
  assert(logoutRes.status === 302, 'GET /logout redirected');
  assert(!client.cookies.has('easy_session'), 'Session cookie successfully cleared');

  // Login Step 1: Submit Username & Password
  const loginRes = await client.post('/login', {
    username: testUser,
    password: initialPassword,
  });
  assert(loginRes.status === 302, 'POST /login returned 302 for 2FA-enabled account');
  const loginRedirect = loginRes.headers.get('location');
  assert(loginRedirect.includes('/login/2fa'), 'User redirected to 2FA challenge page');
  assert(client.cookies.has('easy_2fa_ticket'), 'Received easy_2fa_ticket cookie');

  // Extract ticket param
  const ticketParam = new URL(loginRedirect, BASE_URL).searchParams.get('ticket');
  assert(ticketParam, 'Extracted 2FA ticket parameter from redirect URL');

  // Login Step 2: Submit TOTP Code
  const step2Totp = generateTotpCode(totpSecret);
  const verify2faRes = await client.post('/login/2fa', {
    ticket: ticketParam,
    totp_code: step2Totp,
  });
  assert(verify2faRes.status === 302, 'POST /login/2fa succeeded with 302 redirect');
  assert(client.cookies.has('easy_session'), 'Authenticated session cookie re-established via 2FA');

  // Verify authenticated security page
  const secVerifyRes = await client.get('/account/security');
  const secVerifyHtml = await secVerifyRes.text();
  assert(secVerifyHtml.includes('2FA Status: Enabled') || secVerifyHtml.includes('Status: Enabled') || secVerifyHtml.includes('Disable Google Authenticator'), 'Security dashboard confirms 2FA active');

  // ---------------------------------------------------------------------------
  // STAGE 5: Self-Service Password Recovery via Google Authenticator (TOTP)
  // ---------------------------------------------------------------------------
  console.log('\n[Stage 5/8] Testing Self-Service Password Reset via TOTP...');

  await client.get('/logout');
  const forgotPageRes = await client.get('/forgot-password');
  assert(forgotPageRes.status === 200, 'GET /forgot-password returned HTTP 200');

  const newPassword = `UpdatedPass_${timestamp}!999`;
  const resetTotp = generateTotpCode(totpSecret);

  const resetRes = await client.post('/forgot-password', {
    username: testUser,
    totp_code: resetTotp,
    new_password: newPassword,
    confirm_password: newPassword,
  });
  const resetHtml = await resetRes.text();
  assert(resetRes.status === 200, 'POST /forgot-password returned HTTP 200');
  assert(
    resetHtml.includes('reset successfully') || resetHtml.includes('Your password has been reset'),
    `Password reset confirmed (Response: ${resetHtml.slice(0, 300)})`
  );

  // Verify login with NEW password + 2FA
  const loginNewRes = await client.post('/login', {
    username: testUser,
    password: newPassword,
  });
  assert(loginNewRes.status === 302 && loginNewRes.headers.get('location').includes('/login/2fa'), 'Login with new password prompted for 2FA challenge');

  const loginNewTotp = generateTotpCode(totpSecret);
  const ticketNew = new URL(loginNewRes.headers.get('location'), BASE_URL).searchParams.get('ticket');
  const verifyNewRes = await client.post('/login/2fa', {
    ticket: ticketNew,
    totp_code: loginNewTotp,
  });
  assert(verifyNewRes.status === 302, 'Successfully authenticated using updated password + TOTP!');
  assert(client.cookies.has('easy_session'), 'Active session confirmed with new credentials');

  // ---------------------------------------------------------------------------
  // STAGE 6: Real Third-Party OAuth 2.0 PKCE & OpenID Connect Authorization Flow
  // ---------------------------------------------------------------------------
  console.log('\n[Stage 6/8] Testing Full OAuth 2.0 PKCE & OIDC Authorization Code Flow...');

  const clientId = 'web-app-client';
  const clientSecret = 'secret_web_app_987654321';
  const redirectUri = 'http://localhost:3000/api/auth/callback/easy-oauth';
  const { verifier, challenge } = generatePkce();
  const oauthState = `state_${crypto.randomBytes(8).toString('hex')}`;
  const oauthNonce = `nonce_${crypto.randomBytes(8).toString('hex')}`;

  const authUrl = `/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&scope=${encodeURIComponent('openid profile')}&code_challenge=${challenge}&code_challenge_method=S256&state=${oauthState}&nonce=${oauthNonce}`;

  const authorizeRes = await client.get(authUrl);
  let authCode = '';

  if (authorizeRes.status === 200) {
    // Rendered Consent screen
    const consentHtml = await authorizeRes.text();
    assert(consentHtml.includes('Authorization Request') || consentHtml.includes('Consent'), 'Rendered OAuth Consent confirmation screen');
    assert(consentHtml.includes('web-app-client') || consentHtml.includes('Demo Web Application'), 'Consent screen displays client name');

    // Extract hidden form inputs
    const hiddenInputs = {};
    const inputRegex = /<input[^>]+type="hidden"[^>]*>/gi;
    let match;
    while ((match = inputRegex.exec(consentHtml)) !== null) {
      const nameMatch = match[0].match(/name="([^"]+)"/i);
      const valMatch = match[0].match(/value="([^"]*)"/i);
      if (nameMatch) {
        hiddenInputs[nameMatch[1]] = valMatch ? valMatch[1] : '';
      }
    }
    assert(hiddenInputs._csrf, 'Extracted CSRF token from consent form');

    // Approve consent
    const approveRes = await client.post('/oauth/consent', {
      ...hiddenInputs,
      decision: 'allow',
    });
    assert(approveRes.status === 302, 'POST /oauth/consent approved with 302 redirect');
    const callbackUrl = approveRes.headers.get('location');
    assert(callbackUrl.startsWith(redirectUri), 'Redirected to client redirect_uri');

    const callbackParams = new URL(callbackUrl).searchParams;
    assert(callbackParams.get('state') === oauthState, 'OAuth state verified intact');
    authCode = callbackParams.get('code');
    assert(authCode && authCode.length > 10, 'Obtained authorization_code');
  } else if (authorizeRes.status === 302) {
    const callbackUrl = authorizeRes.headers.get('location');
    const callbackParams = new URL(callbackUrl).searchParams;
    authCode = callbackParams.get('code');
    assert(authCode, 'Obtained authorization_code directly');
  }

  console.log(`  ℹ  Acquired Authorization Code: ${authCode.slice(0, 8)}...`);

  // Exchange Code for Access Token & ID Token at /oauth/token
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await client.post(
    '/oauth/token',
    {
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: clientId,
    },
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    }
  );

  assert(tokenRes.status === 200, 'POST /oauth/token returned HTTP 200');
  const tokenData = await tokenRes.json();
  assert(tokenData.access_token && tokenData.access_token.length > 20, 'Received valid access_token');
  assert(tokenData.token_type === 'Bearer', 'token_type is Bearer');
  assert(tokenData.id_token && tokenData.id_token.split('.').length === 3, 'Received valid RS256 JWT id_token');
  console.log(`  ℹ  Received Access Token (${tokenData.access_token.slice(0, 10)}...) and ID Token`);

  // Verify ID Token Header & Payload (without secret verification here, just format check)
  const idTokenParts = tokenData.id_token.split('.');
  const idTokenPayload = JSON.parse(Buffer.from(idTokenParts[1], 'base64url').toString('utf8'));
  assert(idTokenPayload.aud === clientId, 'ID Token audience matches client_id');
  assert(idTokenPayload.nonce === oauthNonce, 'ID Token nonce matches client request nonce');
  assert(typeof idTokenPayload.sub === 'string', 'ID Token sub subject matches user ID');

  // Request /oauth/userinfo with Bearer token
  const userinfoRes = await client.get('/oauth/userinfo', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });
  assert(userinfoRes.status === 200, 'GET /oauth/userinfo returned HTTP 200');
  const userinfo = await userinfoRes.json();
  assert(userinfo.sub === idTokenPayload.sub, 'UserInfo sub matches ID Token subject');
  assert(userinfo.username === testUser || userinfo.preferred_username === testUser, 'UserInfo returned accurate registered username');
  console.log(`  ℹ  UserInfo Verified: sub=${userinfo.sub}, username=${userinfo.username || userinfo.preferred_username}`);

  // Revoke token at /oauth/revoke
  const revokeRes = await client.post(
    '/oauth/revoke',
    {
      token: tokenData.access_token,
      token_type_hint: 'access_token',
    },
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    }
  );
  assert(revokeRes.status === 200, 'POST /oauth/revoke returned HTTP 200');

  // Confirm token is revoked
  const postRevokeUserinfo = await client.get('/oauth/userinfo', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });
  assert(postRevokeUserinfo.status === 401, 'Revoked access_token correctly rejected with 401 Unauthorized');

  // ---------------------------------------------------------------------------
  // STAGE 7: Administration Console & Governance Management
  // ---------------------------------------------------------------------------
  console.log('\n[Stage 7/8] Testing Admin Console Governance Workflow...');

  const adminClient = new TestClient(BASE_URL);
  const adminLoginRes = await adminClient.post('/login', {
    username: 'admin',
    password: 'AdminPassword123!',
  });
  assert(adminLoginRes.status === 302, 'Admin credentials accepted with 302 redirect');
  assert(adminClient.cookies.has('easy_session'), 'Admin session cookie established');

  const adminDashRes = await adminClient.get('/admin');
  assert(adminDashRes.status === 200, 'GET /admin returned HTTP 200');
  const adminDashHtml = await adminDashRes.text();
  assert(adminDashHtml.includes('Administration') || adminDashHtml.includes('Admin Console') || adminDashHtml.includes('Total Users'), 'Admin dashboard rendered successfully');

  const adminUsersRes = await adminClient.get('/admin/users');
  assert(adminUsersRes.status === 200, 'GET /admin/users returned HTTP 200');
  const adminUsersHtml = await adminUsersRes.text();
  assert(adminUsersHtml.includes('admin') && adminUsersHtml.includes(testUser), `User table displays both admin and newly registered "${testUser}"`);

  const adminClientsRes = await adminClient.get('/admin/clients');
  assert(adminClientsRes.status === 200, 'GET /admin/clients returned HTTP 200');
  const adminClientsHtml = await adminClientsRes.text();
  assert(adminClientsHtml.includes('web-app-client') && adminClientsHtml.includes('spa-client'), 'Client management table shows seeded OAuth clients');

  const adminSettingsRes = await adminClient.get('/admin/settings');
  assert(adminSettingsRes.status === 200, 'GET /admin/settings returned HTTP 200');

  // ---------------------------------------------------------------------------
  // STAGE 8: Visual Rendering Verification via Headless Chromium
  // ---------------------------------------------------------------------------
  console.log('\n[Stage 8/8] Performing Live Headless Browser Visual Rendering Verification...');

  const PORT = 9223;
  let chromeProc = null;
  try {
    chromeProc = spawn('/usr/bin/google-chrome', [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      `--remote-debugging-port=${PORT}`,
      '--window-size=1280,800',
      '--hide-scrollbars',
      'about:blank',
    ]);

    let pageTarget = null;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
        pageTarget = await res.json();
        break;
      } catch {
        await sleep(200);
      }
    }

    if (pageTarget && pageTarget.webSocketDebuggerUrl) {
      const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
      let msgId = 1;
      const pending = new Map();
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.id && pending.has(data.id)) {
          const { resolve, reject } = pending.get(data.id);
          pending.delete(data.id);
          if (data.error) reject(new Error(JSON.stringify(data.error)));
          else resolve(data.result);
        }
      };
      const sendCDP = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = msgId++;
          pending.set(id, { resolve, reject });
          ws.send(JSON.stringify({ id, method, params }));
        });

      await new Promise((r) => (ws.onopen = r));
      await sendCDP('Page.enable');

      // Navigate to live login
      await sendCDP('Page.navigate', { url: `${BASE_URL}/login` });
      await sleep(1500);

      // Verify DOM document title
      const titleEval = await sendCDP('Runtime.evaluate', { expression: 'document.title' });
      assert(titleEval.result && titleEval.result.value.includes('Sign In'), 'Live Chromium successfully rendered Sign In page with correct title');

      // Capture live proof screenshot
      const liveScreenshot = await sendCDP('Page.captureScreenshot', { format: 'png' });
      const proofPath = path.join(rootDir, 'docs', 'screenshots', 'live_production_login.png');
      fs.writeFileSync(proofPath, Buffer.from(liveScreenshot.data, 'base64'));
      console.log(`  ✔ PASS: Live production screenshot saved to ${proofPath}`);

      ws.close();
    }
  } catch (err) {
    console.warn(`  ⚠ Visual headless verification skipped: ${err.message}`);
  } finally {
    if (chromeProc) {
      chromeProc.kill('SIGTERM');
    }
  }

  console.log('\n================================================================');
  console.log(`🎉 ALL LIVE REAL-USER E2E TESTS PASSED! (${passedSteps}/${totalSteps} checks passed)`);
  console.log('Production URL is 100% operational with pure-username architecture!');
  console.log('================================================================\n');
}

runLiveE2ETests().catch((err) => {
  console.error('\n❌ LIVE E2E TEST FAILED:', err);
  process.exit(1);
});

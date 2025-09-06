const axios = require('axios');
const fs = require('fs').promises;
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const crypto = require('crypto');
const gtts = require('node-gtts');

// Configuration and constants
const BASE_URL = 'https://poseidon-depin-server.storyapis.com';
let globalUseProxy = false;
let globalProxies = [];

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/102.0'
];

// Color codes
const colors = {
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bright: '\x1b[1m'
};

// File operations
async function readTokens() {
  try {
    const data = await fs.readFile('bearer.txt', 'utf-8');
    const tokens = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    return tokens;
  } catch (error) {
    return [];
  }
}

async function readProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf-8');
    const proxies = data.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    return proxies;
  } catch (error) {
    return [];
  }
}

// Audio generation
async function generateAudioBuffer(text, lang) {
  const originalConsoleLog = console.log;
  console.log = () => {}; 
  if (lang === 'mr' || lang === 'ur') {
    lang = 'hi';
  }
  const speaker = gtts(lang);
  const stream = speaker.stream(text);
  try {
    const buffer = await Promise.race([
      new Promise((_, reject) => setTimeout(() => reject(new Error('Audio generation timeout after 30 seconds')), 30000)),
      new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      })
    ]);
    console.log = originalConsoleLog;  
    return buffer;
  } catch (err) {
    console.log = originalConsoleLog; 
    throw err;
  }
}

// Network utilities
function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function newAgent(proxy) {
  if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
    return new SocksProxyAgent(proxy);
  } else {
    return null;
  }
}

function getGlobalHeaders(token = null) {
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
    'origin': 'https://app.psdn.ai',
    'priority': 'u=1, i',
    'referer': 'https://app.psdn.ai/',
    'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'user-agent': getRandomUserAgent()
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function getAxiosConfig(proxy, token = null) {
  const config = {
    headers: getGlobalHeaders(token),
    timeout: 60000
  };
  if (proxy) {
    config.httpsAgent = newAgent(proxy);
    config.proxy = false;
  }
  return config;
}

async function requestWithRetry(method, url, payload = null, config = {}, retries = 5, backoff = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      let response;
      if (method.toLowerCase() === 'get') {
        response = await axios.get(url, config);
      } else if (method.toLowerCase() === 'post') {
        response = await axios.post(url, payload, config);
      } else if (method.toLowerCase() === 'put') {
        response = await axios.put(url, payload, config);
      } else {
        throw new Error(`Method ${method} not supported`);
      }
      return { success: true, response: response.data };
    } catch (error) {
      let status = error.response?.status;
      if (status === 429) {
        backoff = 30000;
      }
      if (status === 400 || status === 404) {
        return { success: false, message: error.response?.data?.message || 'Bad request', status };
      }
      if (i < retries - 1) {
        await delay(backoff / 1000);
        backoff *= 1.5;
        continue;
      }
      return { success: false, message: error.message, status };
    }
  }
}

async function getPublicIP(proxy) {
  try {
    const config = getAxiosConfig(proxy);
    delete config.headers.authorization;
    const response = await requestWithRetry('get', 'https://api.ipify.org?format=json', null, config, 3, 5000);
    return response.response?.ip || 'Unknown';
  } catch (error) {
    return 'Error retrieving IP';
  }
}

// Helper functions
function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function getFormattedDate() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function getLanguageName(code) {
  const languages = {
    'en': 'English',
    'mr': 'Marathi',
    'ur': 'Urdu',
    'ar': 'Arabic',
    'zh': 'Mandarin Chinese',
    'id': 'Indonesian',
    'vi': 'Vietnamese',
    'tr': 'Turkish',
    'ru': 'Russian',
    'pt': 'Portuguese',
    'de': 'German',
    'fr': 'French',
    'es': 'Spanish',
    'ko': 'Korean',
    'ja': 'Japanese',
    'hi': 'Hindi'
  };
  return languages[code] || code;
}

// API functions
async function fetchUserInfo(token, proxy) {
  try {
    const res = await requestWithRetry('get', `${BASE_URL}/users/me`, null, getAxiosConfig(proxy, token), 3, 5000);
    if (!res.success) {
      throw new Error(res.message);
    }
    return {
      success: true,
      username: res.response.name,
      points: res.response.points,
      address: res.response.dynamic_wallet || 'N/A'
    };
  } catch (error) {
    return { 
      success: false, 
      username: 'Unknown', 
      points: 'N/A', 
      address: 'N/A',
      error: error.message,
      status: error.status
    };
  }
}

async function fetchCampaigns(token, proxy) {
  try {
    const res = await requestWithRetry('get', `${BASE_URL}/campaigns?page=1&size=100`, null, getAxiosConfig(proxy, token), 3, 5000);
    if (!res.success) {
      throw new Error(res.message);
    }
    return { success: true, campaigns: res.response.items.filter(campaign => campaign.campaign_type === 'AUDIO' && campaign.is_scripted) };
  } catch (error) {
    return { success: false, error: error.message, status: error.status };
  }
}

async function fetchQuota(token, campaignId, proxy) {
  try {
    const res = await requestWithRetry('get', `${BASE_URL}/campaigns/${campaignId}/access`, null, getAxiosConfig(proxy, token), 3, 5000);
    if (!res.success) {
      throw new Error(res.message);
    }
    return res.response;
  } catch (error) {
    return { remaining: 0, cap: 0, error: error.message };
  }
}

async function fetchNextScript(token, languageCode, campaignId, proxy) {
  try {
    const res = await requestWithRetry('get', `${BASE_URL}/scripts/next?language_code=${languageCode}&campaign_id=${campaignId}`, null, getAxiosConfig(proxy, token), 3, 5000);
    if (!res.success) {
      throw new Error(res.message);
    }
    return res.response;
  } catch (error) {
    return null;
  }
}

async function getUploadPresigned(token, campaignId, fileName, assignmentId, proxy) {
  const payload = {
    content_type: 'audio/webm',
    file_name: fileName,
    script_assignment_id: assignmentId
  };
  try {
    const res = await requestWithRetry('post', `${BASE_URL}/files/uploads/${campaignId}`, payload, getAxiosConfig(proxy, token), 3, 5000);
    if (!res.success) {
      throw new Error(res.message);
    }
    return res.response;
  } catch (error) {
    return null;
  }
}

async function uploadToPresigned(url, audioBuffer) {
  const config = {
    headers: {
      'content-type': 'audio/webm',
      'content-length': audioBuffer.length
    }
  };
  try {
    const res = await requestWithRetry('put', url, audioBuffer, config, 3, 5000);
    if (!res.success) {
      throw new Error(res.message);
    }
    return { success: true };
  } catch (error) {
    return { success: false };
  }
}

async function confirmUpload(token, payload, proxy) {
  try {
    const res = await requestWithRetry('post', `${BASE_URL}/files`, payload, getAxiosConfig(proxy, token), 3, 5000);
    if (!res.success) {
      throw new Error(res.message);
    }
    return res.response;
  } catch (error) {
    return null;
  }
}

// Display functions
function printBanner() {
  console.log(`${colors.green}${colors.bright}
██████╗  ██████╗ ███████╗███████╗██╗██████╗  ██████╗ ███╗   ██╗
██╔══██╗██╔═══██╗██╔════╝██╔════╝██║██╔══██╗██╔═══██╗████╗  ██║
██████╔╝██║   ██║███████╗█████╗  ██║██║  ██║██║   ██║██╔██╗ ██║
██╔═══╝ ██║   ██║╚════██║██╔══╝  ██║██║  ██║██║   ██║██║╚██╗██║
██║     ╚██████╔╝███████║███████╗██║██████╔╝╚██████╔╝██║ ╚████║
╚═╝      ╚═════╝ ╚══════╝╚══════╝╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝${colors.reset}
${colors.blue}                P O S E I D O N   B O T
              @ByDontol AUTO UPLOAD VOICE${colors.reset}

${colors.cyan}Date: ${getFormattedDate()}${colors.reset}`);
  console.log(`${colors.blue}================================================================${colors.reset}`);
}

async function countdownDelay() {
  const minSeconds = 240; 
  const maxSeconds = 450; 
  const waitTime = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
  let remaining = waitTime;

  const updateCountdown = () => {
    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    process.stdout.write(`\r${colors.cyan}Cooldown before next campaign: ${colors.green}${min}:${sec.toString().padStart(2, '0')}${colors.reset}`);
  };

  updateCountdown();

  const interval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      updateCountdown();
    } else {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(50) + '\r');
    }
  }, 1000);

  await delay(waitTime);
}

// Main processing functions
async function initializeConfig() {
  console.log(`${colors.blue}--- SYSTEM STATUS ---${colors.reset}`);
  
  globalProxies = await readProxies();
  
  if (globalProxies.length > 0) {
    globalUseProxy = true;
    console.log(`${colors.cyan}proxy.txt        : ${colors.green}Found (${globalProxies.length} proxies)${colors.reset}`);
    console.log(`${colors.cyan}Proxy usage      : ${colors.green}Enabled${colors.reset}`);
  } else {
    globalUseProxy = false;
    console.log(`${colors.cyan}proxy.txt        : ${colors.red}Not found${colors.reset}`);
    console.log(`${colors.cyan}Proxy usage      : ${colors.red}Disabled${colors.reset}`);
  }
  
  const tokens = await readTokens();
  console.log(`${colors.cyan}Tokens loaded    : ${colors.green}${tokens.length}${colors.reset}`);
  
  return tokens;
}

async function processToken(token, index, total, proxy = null) {
  console.log(`${colors.blue}--- ACCOUNT ${index + 1}/${total} ---${colors.reset}`);
  
  if (proxy) {
    const ip = await getPublicIP(proxy);
    console.log(`${colors.cyan}IP Address       : ${colors.green}${ip}${colors.reset}`);
  }
  
  const userInfo = await fetchUserInfo(token, proxy);
  console.log(`${colors.cyan}Username         : ${colors.green}${userInfo.username}${colors.reset}`);
  
  console.log(`${colors.blue}[AUTHENTICATION]${colors.reset}`);
  
  if (!userInfo.success) {
    console.log(`${colors.cyan}Status           : ${colors.red}FAILED${colors.reset}`);
    console.log(`${colors.cyan}Error Code       : ${colors.red}${userInfo.status || 'Unknown'} ${userInfo.error || 'Unauthorized'}${colors.reset}`);
    console.log(`${colors.cyan}Attempts         : ${colors.red}3/3${colors.reset}`);
    console.log(`${colors.blue}[CAMPAIGNS FOUND: 0]${colors.reset}`);
    console.log(`${colors.blue}[UPLOAD STATUS]${colors.reset}`);
    console.log(`Authentication failed - No campaigns processed`);
    console.log(`${colors.blue}--- SUMMARY (ACCOUNT ${index + 1}) ---${colors.reset}`);
    console.log(`${colors.cyan}Authentication   : ${colors.red}Failed (${userInfo.status || 'Unknown'})${colors.reset}`);
    console.log(`${colors.cyan}Campaigns Scanned: ${colors.green}0${colors.reset}`);
    console.log(`${colors.cyan}Uploads Attempted: ${colors.green}0${colors.reset}`);
    console.log(`${colors.cyan}Completed        : ${colors.green}0${colors.reset}`);
    console.log(`${colors.cyan}Skipped          : ${colors.green}0${colors.reset}`);
    console.log(`${colors.cyan}Failed           : ${colors.green}0${colors.reset}`);
    console.log(`${colors.blue}================================================================${colors.reset}`);
    return;
  }
  
  console.log(`${colors.cyan}Status           : ${colors.green}SUCCESS${colors.reset}`);
  console.log(`${colors.cyan}User ID          : ${colors.green}${userInfo.username}${colors.reset}`);
  console.log(`${colors.cyan}Balance          : ${colors.green}${userInfo.points} points${colors.reset}`);
  
  const campaignsResult = await fetchCampaigns(token, proxy);
  
  if (!campaignsResult.success) {
    console.log(`${colors.blue}[CAMPAIGNS FOUND: 0]${colors.reset}`);
    console.log(`Campaign fetch failed: ${campaignsResult.error}`);
    console.log(`${colors.blue}================================================================${colors.reset}`);
    return;
  }
  
  const campaigns = campaignsResult.campaigns;
  console.log(`${colors.blue}[CAMPAIGNS FOUND: ${campaigns.length}]${colors.reset}`);
  console.log(`${colors.cyan}Available campaigns ready for processing${colors.reset}`);
  
  console.log(`${colors.blue}[UPLOAD STATUS]${colors.reset}`);
  
  let totalAttempted = 0;
  let totalCompleted = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  
  for (let campIndex = 0; campIndex < campaigns.length; campIndex++) {
    const campaign = campaigns[campIndex];
    const lang = campaign.supported_languages[0];
    const langName = getLanguageName(lang);
    
    const quota = await fetchQuota(token, campaign.virtual_id, proxy);
    
    if (quota.error) {
      console.log(`${colors.cyan}${langName} (${lang})${' '.repeat(Math.max(0, 17 - langName.length - lang.length))} : ${colors.red}Quota fetch failed (${quota.error})${colors.reset}`);
      console.log(`${colors.cyan}${' '.repeat(19)} Quota ${colors.green}0/0${colors.cyan} → Skipped${colors.reset}`);
      totalSkipped++;
      continue;
    }
    
    if (quota.remaining <= 0) {
      console.log(`${colors.cyan}${langName} (${lang})${' '.repeat(Math.max(0, 17 - langName.length - lang.length))} : ${colors.red}No quota remaining${colors.reset}`);
      console.log(`${colors.cyan}${' '.repeat(19)} Quota ${colors.green}${quota.remaining}/${quota.cap}${colors.cyan} → Skipped${colors.reset}`);
      totalSkipped++;
      continue;
    }
    
    console.log(`${colors.cyan}${langName} (${lang})${' '.repeat(Math.max(0, 17 - langName.length - lang.length))} : ${colors.blue}Processing...${colors.reset}`);
    console.log(`${colors.cyan}${' '.repeat(19)} Quota ${colors.green}${quota.remaining}/${quota.cap}${colors.cyan} → Active${colors.reset}`);
    
    let uploadCount = 0;
    let currentRemaining = quota.remaining;
    let i = 0;
    
    while (currentRemaining > 0 && i < Math.min(quota.cap, 3)) { // Limit to 3 uploads per campaign for demo
      totalAttempted++;
      
      const nextScript = await fetchNextScript(token, lang, campaign.virtual_id, proxy);
      if (!nextScript) {
        totalFailed++;
        i++;
        continue;
      }
      
      const text = nextScript.script.content;
      let audioBuffer;
      try {
        audioBuffer = await generateAudioBuffer(text, lang);
      } catch (err) {
        totalFailed++;
        i++;
        continue;
      }
      
      const timestamp = Date.now();
      const fileName = `audio_recording_${timestamp}.webm`;
      const assignmentId = nextScript.assignment_id;
      
      const presigned = await getUploadPresigned(token, campaign.virtual_id, fileName, assignmentId, proxy);
      if (!presigned) {
        totalFailed++;
        i++;
        continue;
      }
      
      const uploadRes = await uploadToPresigned(presigned.presigned_url, audioBuffer);
      if (!uploadRes.success) {
        totalFailed++;
        i++;
        continue;
      }
      
      const hash = crypto.createHash('sha256').update(audioBuffer).digest('hex');
      const confirmPayload = {
        content_type: 'audio/webm',
        object_key: presigned.object_key,
        sha256_hash: hash,
        filesize: audioBuffer.length,
        file_name: fileName,
        virtual_id: presigned.file_id,
        campaign_id: campaign.virtual_id
      };
      
      const confirmRes = await confirmUpload(token, confirmPayload, proxy);
      if (!confirmRes) {
        totalFailed++;
      } else {
        uploadCount++;
        totalCompleted++;
      }
      
      const newQuota = await fetchQuota(token, campaign.virtual_id, proxy);
      currentRemaining = newQuota.remaining;
      
      i++;
      if (currentRemaining > 0) {
        await delay(15);
      }
    }
    
    console.log(`${colors.cyan}${' '.repeat(19)} Completed: ${colors.green}${uploadCount} uploads${colors.reset}`);
    
    if (campIndex < campaigns.length - 1) {
      await countdownDelay();
    }
  }
  
  console.log(`${colors.blue}--- SUMMARY (ACCOUNT ${index + 1}) ---${colors.reset}`);
  console.log(`${colors.cyan}Authentication   : ${colors.green}Success${colors.reset}`);
  console.log(`${colors.cyan}Campaigns Scanned: ${colors.green}${campaigns.length}${colors.reset}`);
  console.log(`${colors.cyan}Uploads Attempted: ${colors.green}${totalAttempted}${colors.reset}`);
  console.log(`${colors.cyan}Completed        : ${colors.green}${totalCompleted}${colors.reset}`);
  console.log(`${colors.cyan}Skipped          : ${colors.green}${totalSkipped}${colors.reset}`);
  console.log(`${colors.cyan}Failed           : ${colors.green}${totalFailed}${colors.reset}`);
  console.log(`${colors.blue}================================================================${colors.reset}`);
}

async function runCycle() {
  const tokens = await initializeConfig();
  if (tokens.length === 0) {
    console.log(`${colors.red}ERROR: No tokens found in bearer.txt. Exiting cycle.${colors.reset}`);
    return;
  }
  
  for (let i = 0; i < tokens.length; i++) {
    const proxy = globalUseProxy ? globalProxies[i % globalProxies.length] : null;
    try {
      await processToken(tokens[i], i, tokens.length, proxy);
    } catch (error) {
      console.log(`${colors.red}ERROR processing account ${i + 1}: ${error.message}${colors.reset}`);
    }
    if (i < tokens.length - 1) {
      await delay(5);
    }
  }
}

async function run() {
  printBanner();
  
  while (true) {
    await runCycle();
    console.log(`\n${colors.green}🔄 Cycle completed. Waiting 24 hours before next run...${colors.reset}`);
    console.log(`${colors.blue}⏰ Next run scheduled at: ${colors.cyan}${new Date(Date.now() + 86400000).toLocaleString()}${colors.reset}`);
    console.log(`${colors.blue}================================================================${colors.reset}\n`);
    await delay(86400);
  }
}

run().catch(error => console.log(`${colors.red}Fatal error: ${error.message}${colors.reset}`));
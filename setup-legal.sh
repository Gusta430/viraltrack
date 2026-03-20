#!/bin/bash
# ViralTrack — Legg til Terms of Service og Privacy Policy
# Kjør dette fra prosjektmappen din (viraltrack/)

set -e

echo ""
echo "🎵 ViralTrack — Legger til Terms of Service og Privacy Policy..."
echo ""

# Sjekk at vi er i riktig mappe
if [ ! -f "frontend/public/index.html" ]; then
  echo "❌ Finner ikke frontend/public/index.html"
  echo "   Kjør dette skriptet fra prosjektmappen din (viraltrack/)"
  exit 1
fi

echo "✅ Fant prosjektet"

# ── 1. Lag terms.html ──
echo "📄 Lager terms.html..."
cat > frontend/public/terms.html << 'TERMSEOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service — ViralTrack</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#0e0b14;--surface:#16121f;--card:#1c1726;--bdr:#2a2235;--t1:#f0edf5;--t2:#9b93a8;--t3:#6b6279;--ac:#8b5cf6;--ac-s:rgba(139,92,246,.15);--ac-g:rgba(139,92,246,.3);--r:12px;--rs:8px}
    body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--t1);min-height:100vh;-webkit-font-smoothing:antialiased}
    .topbar{position:sticky;top:0;z-index:100;background:rgba(14,11,20,.85);backdrop-filter:blur(16px);border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;padding:16px 24px}
    .topbar-logo{font-family:'Space Mono',monospace;font-size:18px;font-weight:700;color:var(--t1);text-decoration:none;letter-spacing:-.5px}
    .topbar-logo span{color:var(--ac)}
    .topbar-back{color:var(--t2);text-decoration:none;font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;transition:.15s}
    .topbar-back:hover{color:var(--ac)}
    .content{max-width:740px;margin:0 auto;padding:60px 24px 100px}
    .doc-badge{display:inline-block;padding:4px 12px;background:var(--ac-s);color:var(--ac);border-radius:20px;font-size:12px;font-weight:600;margin-bottom:16px}
    .doc-title{font-size:36px;font-weight:700;letter-spacing:-1px;margin-bottom:8px}
    .doc-date{font-size:14px;color:var(--t3);margin-bottom:48px}
    h2{font-size:20px;font-weight:700;margin-top:48px;margin-bottom:16px;color:var(--t1);letter-spacing:-.3px}
    p{font-size:15px;line-height:1.75;color:var(--t2);margin-bottom:16px}
    p strong{color:var(--t1);font-weight:600}
    .highlight-box{padding:20px 24px;margin:24px 0;background:var(--ac-s);border-left:3px solid var(--ac);border-radius:0 var(--rs) var(--rs) 0}
    .highlight-box p{color:#c4b5fd;margin-bottom:0}
    .doc-footer{margin-top:64px;padding-top:32px;border-top:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px}
    .doc-footer a{color:var(--ac);text-decoration:none;font-size:13px;font-weight:500}
    .doc-footer a:hover{text-decoration:underline}
    .doc-footer span{font-size:12px;color:var(--t3)}
    @media(max-width:768px){.content{padding:32px 16px 80px}.doc-title{font-size:26px}h2{font-size:18px;margin-top:36px}}
  </style>
</head>
<body>
<div class="topbar">
  <a href="/" class="topbar-logo">🎵 <span>ViralTrack</span></a>
  <a href="/" class="topbar-back"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Back to app</a>
</div>
<div class="content">
  <div class="doc-badge">Legal</div>
  <h1 class="doc-title">Terms of Service</h1>
  <div class="doc-date">Effective Date: March 19, 2026</div>

  <p>Welcome to ViralTrack ("we," "our," or the "Service"). These Terms of Service govern your access to and use of the ViralTrack platform, including our website, AI-powered analysis tools, promotional content generators, and all related services.</p>

  <h2>1. Acceptance of Terms</h2>
  <p>By creating an account, uploading content, or using any feature of ViralTrack, you agree to be bound by these Terms of Service. If you do not agree, do not use the Service. We may update these Terms from time to time. Continued use after changes constitutes acceptance of the revised Terms.</p>

  <h2>2. Description of Service</h2>
  <p>ViralTrack is an AI-powered music marketing platform that provides: <strong>(a)</strong> AI-generated track analysis including tempo, mood, energy, and audience insights; <strong>(b)</strong> AI-generated promotional strategies and 4-week launch plans; <strong>(c)</strong> AI-generated video suggestions and promotional video creation; <strong>(d)</strong> AI-generated captions, hashtags, and content ideas for social media.</p>
  <p>The Service uses artificial intelligence to generate content. AI-generated outputs are suggestions and should be reviewed by you before use. ViralTrack does not guarantee any specific marketing results, streaming numbers, or audience growth.</p>

  <h2>3. Account Registration</h2>
  <p>You must provide accurate information when creating an account. You are responsible for maintaining the confidentiality of your login credentials and for all activities under your account. You must be at least 16 years old to use the Service. If you are under 18, you represent that you have your parent's or guardian's consent.</p>

  <h2>4. Your Content</h2>
  <p>"Your Content" means any audio files, metadata, artist information, or other materials you upload to or input into the Service.</p>
  <div class="highlight-box">
    <p><strong>You retain all ownership rights to Your Content.</strong> By uploading content, you grant ViralTrack a limited, non-exclusive, worldwide license to process, analyze, and store Your Content solely for the purpose of providing the Service to you. This license terminates when you delete Your Content or your account.</p>
  </div>
  <p>You represent and warrant that: <strong>(a)</strong> you own or have the necessary rights to Your Content; <strong>(b)</strong> Your Content does not infringe any third-party intellectual property rights; <strong>(c)</strong> you have the right to grant the license above. ViralTrack is not responsible for verifying the ownership of uploaded content.</p>

  <h2>5. AI-Generated Content</h2>
  <p>"AI-Generated Content" means all analyses, promo plans, video suggestions, captions, hashtags, and promotional videos created by the Service based on Your Content and inputs.</p>
  <p>You are granted a non-exclusive, perpetual, worldwide license to use AI-Generated Content for your personal and commercial music promotion purposes. You may post AI-Generated Content to social media, use it in marketing materials, and share it publicly.</p>
  <p>You acknowledge that: <strong>(a)</strong> AI-Generated Content is machine-generated and may contain errors or inaccuracies; <strong>(b)</strong> similar AI-Generated Content may be produced for other users with similar inputs; <strong>(c)</strong> ViralTrack does not guarantee that AI-Generated Content is unique or original; <strong>(d)</strong> you are solely responsible for reviewing AI-Generated Content before publishing or distributing it.</p>

  <h2>6. Promotional Videos</h2>
  <p>AI-generated promotional videos are created using third-party AI video generation services. You may use generated videos for promoting your music across social media and other channels. Video generation is subject to daily limits as specified in your plan. Generated videos may be stored temporarily and are subject to deletion after a reasonable period.</p>
  <p>You are responsible for ensuring that your use of generated videos complies with the terms of any social media platform where you post them.</p>

  <h2>7. Music Rights and Social Media</h2>
  <p>ViralTrack does not grant you any rights to music you do not already own. When posting AI-generated promotional content that includes or references your music, you are solely responsible for ensuring you have the necessary rights and licenses for that music on each platform.</p>
  <p>ViralTrack is not liable for any copyright claims, takedowns, or disputes arising from your use of AI-Generated Content in connection with music.</p>

  <h2>8. Prohibited Uses</h2>
  <p>You may not: <strong>(a)</strong> use the Service to promote content that is illegal, hateful, or infringes third-party rights; <strong>(b)</strong> upload content you do not have rights to; <strong>(c)</strong> attempt to reverse-engineer, scrape, or extract the AI models or algorithms; <strong>(d)</strong> resell or sublicense access to the Service; <strong>(e)</strong> use automated tools to access the Service beyond normal usage; <strong>(f)</strong> misrepresent AI-Generated Content as human-created analysis when providing professional services to others.</p>

  <h2>9. Subscription and Payments</h2>
  <p>ViralTrack offers free and paid plans. Paid features, pricing, and limits are described on our website and may change with notice. Free trial users may be subject to usage limits. We reserve the right to modify pricing with 30 days' notice to existing subscribers.</p>

  <h2>10. Termination</h2>
  <p>You may delete your account at any time. Upon deletion, your uploaded content and generated analyses will be permanently removed within 30 days. We may suspend or terminate your account if you violate these Terms, with notice where practicable.</p>

  <h2>11. Disclaimer of Warranties</h2>
  <p>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE DO NOT WARRANT THAT: (A) THE SERVICE WILL BE UNINTERRUPTED OR ERROR-FREE; (B) AI-GENERATED CONTENT WILL BE ACCURATE, COMPLETE, OR SUITABLE FOR YOUR NEEDS; (C) ANY PROMOTIONAL STRATEGY WILL ACHIEVE SPECIFIC RESULTS.</p>

  <h2>12. Limitation of Liability</h2>
  <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, VIRALTRACK SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE SERVICE, INCLUDING BUT NOT LIMITED TO LOST PROFITS, LOST DATA, OR REPUTATIONAL HARM. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT YOU PAID US IN THE 12 MONTHS PRECEDING THE CLAIM.</p>

  <h2>13. Indemnification</h2>
  <p>You agree to indemnify and hold ViralTrack harmless from any claims, damages, or expenses arising from: <strong>(a)</strong> your use of the Service; <strong>(b)</strong> Your Content; <strong>(c)</strong> your use of AI-Generated Content; <strong>(d)</strong> your violation of these Terms or any third-party rights.</p>

  <h2>14. Governing Law</h2>
  <p>These Terms are governed by the laws of Norway. Any disputes shall be resolved in the courts of Norway, unless mandatory consumer protection laws in your jurisdiction provide otherwise.</p>

  <h2>15. Contact</h2>
  <p>For questions about these Terms, contact us at: <strong>[your email address]</strong>.</p>

  <div class="doc-footer">
    <div><a href="/privacy.html">Privacy Policy</a></div>
    <span>&copy; 2026 ViralTrack. All rights reserved.</span>
  </div>
</div>
</body>
</html>
TERMSEOF

# ── 2. Lag privacy.html ──
echo "📄 Lager privacy.html..."
cat > frontend/public/privacy.html << 'PRIVEOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — ViralTrack</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#0e0b14;--surface:#16121f;--card:#1c1726;--bdr:#2a2235;--t1:#f0edf5;--t2:#9b93a8;--t3:#6b6279;--ac:#8b5cf6;--ac-s:rgba(139,92,246,.15);--ac-g:rgba(139,92,246,.3);--gr:#22c55e;--gr-s:rgba(34,197,94,.15);--r:12px;--rs:8px}
    body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--t1);min-height:100vh;-webkit-font-smoothing:antialiased}
    .topbar{position:sticky;top:0;z-index:100;background:rgba(14,11,20,.85);backdrop-filter:blur(16px);border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between;padding:16px 24px}
    .topbar-logo{font-family:'Space Mono',monospace;font-size:18px;font-weight:700;color:var(--t1);text-decoration:none;letter-spacing:-.5px}
    .topbar-logo span{color:var(--ac)}
    .topbar-back{color:var(--t2);text-decoration:none;font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;transition:.15s}
    .topbar-back:hover{color:var(--ac)}
    .content{max-width:740px;margin:0 auto;padding:60px 24px 100px}
    .doc-badge{display:inline-block;padding:4px 12px;background:var(--ac-s);color:var(--ac);border-radius:20px;font-size:12px;font-weight:600;margin-bottom:16px}
    .doc-title{font-size:36px;font-weight:700;letter-spacing:-1px;margin-bottom:8px}
    .doc-date{font-size:14px;color:var(--t3);margin-bottom:48px}
    h2{font-size:20px;font-weight:700;margin-top:48px;margin-bottom:16px;color:var(--t1);letter-spacing:-.3px}
    h3{font-size:16px;font-weight:600;margin-top:24px;margin-bottom:12px;color:var(--t1)}
    p{font-size:15px;line-height:1.75;color:var(--t2);margin-bottom:16px}
    p strong{color:var(--t1);font-weight:600}
    .highlight-box{padding:20px 24px;margin:24px 0;background:var(--ac-s);border-left:3px solid var(--ac);border-radius:0 var(--rs) var(--rs) 0}
    .highlight-box p{color:#c4b5fd;margin-bottom:0}
    .green-box{padding:20px 24px;margin:24px 0;background:var(--gr-s);border-left:3px solid var(--gr);border-radius:0 var(--rs) var(--rs) 0}
    .green-box p{color:#86efac;margin-bottom:0}
    .data-table{width:100%;border-collapse:collapse;margin:20px 0 24px;font-size:14px;background:var(--card);border:1px solid var(--bdr);border-radius:var(--r);overflow:hidden}
    .data-table th{text-align:left;padding:12px 16px;background:var(--ac-s);color:var(--ac);font-weight:600;border-bottom:1px solid var(--bdr)}
    .data-table td{padding:12px 16px;border-bottom:1px solid var(--bdr);color:var(--t2);vertical-align:top}
    .data-table tr:last-child td{border-bottom:none}
    .rights-list{list-style:none;padding:0;margin:16px 0}
    .rights-list li{padding:14px 18px;background:var(--card);border:1px solid var(--bdr);border-radius:var(--rs);margin-bottom:8px;font-size:14px;color:var(--t2);line-height:1.6}
    .rights-list li strong{color:var(--t1);display:block;margin-bottom:2px}
    .doc-footer{margin-top:64px;padding-top:32px;border-top:1px solid var(--bdr);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px}
    .doc-footer a{color:var(--ac);text-decoration:none;font-size:13px;font-weight:500}
    .doc-footer a:hover{text-decoration:underline}
    .doc-footer span{font-size:12px;color:var(--t3)}
    @media(max-width:768px){.content{padding:32px 16px 80px}.doc-title{font-size:26px}h2{font-size:18px;margin-top:36px}.data-table{font-size:12px}.data-table th,.data-table td{padding:8px 10px}}
  </style>
</head>
<body>
<div class="topbar">
  <a href="/" class="topbar-logo">🎵 <span>ViralTrack</span></a>
  <a href="/" class="topbar-back"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Back to app</a>
</div>
<div class="content">
  <div class="doc-badge">Legal</div>
  <h1 class="doc-title">Privacy Policy</h1>
  <div class="doc-date">Effective Date: March 19, 2026</div>

  <p>This Privacy Policy explains how ViralTrack ("we," "our," or "us") collects, uses, stores, and protects your personal data when you use our AI-powered music marketing platform. We are committed to protecting your privacy and complying with the General Data Protection Regulation (GDPR) and other applicable privacy laws.</p>

  <h2>1. Data Controller</h2>
  <p>ViralTrack is the data controller for personal data processed through the Service. For questions about data processing, contact us at: <strong>[your email address]</strong>.</p>

  <h2>2. Data We Collect</h2>
  <p>We collect the following categories of personal data:</p>
  <table class="data-table">
    <thead><tr><th>Category</th><th>Data</th><th>Purpose</th></tr></thead>
    <tbody>
      <tr><td><strong>Account Data</strong></td><td>Name, email address, hashed password</td><td>Account creation and authentication</td></tr>
      <tr><td><strong>Track Data</strong></td><td>Audio files, track titles, artist names, genre, similar artists, goals</td><td>AI analysis and promotional content generation</td></tr>
      <tr><td><strong>AI Output Data</strong></td><td>Generated analyses, promo plans, video suggestions, captions</td><td>Delivering the Service and enabling you to access results</td></tr>
      <tr><td><strong>Usage Data</strong></td><td>Pages visited, features used, timestamps</td><td>Improving the Service and troubleshooting</td></tr>
      <tr><td><strong>Session Data</strong></td><td>Authentication tokens, session identifiers</td><td>Maintaining your logged-in state</td></tr>
      <tr><td><strong>Video Data</strong></td><td>AI-generated video prompts and generated video files</td><td>Video generation feature</td></tr>
      <tr><td><strong>Settings Data</strong></td><td>Notification preferences, subscription plan</td><td>Customizing your experience</td></tr>
    </tbody>
  </table>

  <h2>3. Legal Basis for Processing (GDPR)</h2>
  <p>We process your personal data based on the following legal grounds:</p>
  <table class="data-table">
    <thead><tr><th>Legal Basis</th><th>Applies To</th></tr></thead>
    <tbody>
      <tr><td><strong>Contract performance</strong><br>Art. 6(1)(b)</td><td>Account management, AI analysis, promo plan generation, video generation — processing necessary to deliver the Service you requested</td></tr>
      <tr><td><strong>Legitimate interest</strong><br>Art. 6(1)(f)</td><td>Usage analytics, service improvement, security monitoring — our legitimate interest in maintaining and improving the platform</td></tr>
      <tr><td><strong>Consent</strong><br>Art. 6(1)(a)</td><td>Marketing emails and optional notifications — you can withdraw consent at any time in Settings</td></tr>
    </tbody>
  </table>

  <h2>4. How We Use Your Data</h2>
  <p>We use your data to: <strong>(a)</strong> provide AI-powered track analysis and promotional strategies; <strong>(b)</strong> generate promotional videos and content suggestions; <strong>(c)</strong> maintain your account and session; <strong>(d)</strong> store your analyses and reports for your future access; <strong>(e)</strong> improve our AI models and service quality (using aggregated, anonymized data only); <strong>(f)</strong> send notifications you have opted in to; <strong>(g)</strong> prevent abuse and ensure platform security.</p>
  <div class="green-box">
    <p><strong>We do NOT:</strong> sell your personal data to third parties · use your audio files to train AI models · share your music or analysis results with other users without your consent · use your data for advertising purposes.</p>
  </div>

  <h2>5. Third-Party Services</h2>
  <p>We use the following third-party services to provide the platform:</p>
  <table class="data-table">
    <thead><tr><th>Service</th><th>Purpose</th><th>Data Shared</th><th>Location</th></tr></thead>
    <tbody>
      <tr><td><strong>Anthropic</strong> (Claude API)</td><td>AI analysis and promo plan generation</td><td>Track metadata (title, artist, genre, goals) — NOT audio files</td><td>United States</td></tr>
      <tr><td><strong>fal.ai</strong></td><td>AI video generation</td><td>Text prompts describing video concepts</td><td>US / EU</td></tr>
      <tr><td><strong>Turso</strong> (LibSQL)</td><td>Database storage</td><td>All account and track data (encrypted in transit)</td><td>EU (Ireland)</td></tr>
    </tbody>
  </table>
  <p>Where data is transferred outside the EEA, we ensure appropriate safeguards are in place, such as Standard Contractual Clauses (SCCs) or the service provider's adherence to recognized data protection frameworks.</p>

  <h2>6. Data Retention</h2>
  <p><strong>Account data</strong> is kept for as long as your account is active. <strong>Track data and analyses</strong> are kept until you delete them or your account. <strong>AI-generated videos</strong> may be stored temporarily and are subject to deletion after 90 days. <strong>Session tokens</strong> are deleted upon logout.</p>
  <p>If you delete your account, all personal data is permanently removed within 30 days, except where retention is required by law.</p>

  <h2>7. Your Rights (GDPR)</h2>
  <p>Under the GDPR, you have the following rights regarding your personal data:</p>
  <ul class="rights-list">
    <li><strong>Right of access</strong> Request a copy of all personal data we hold about you.</li>
    <li><strong>Right to rectification</strong> Correct inaccurate personal data via Settings or by contacting us.</li>
    <li><strong>Right to erasure</strong> Delete your account and all associated data at any time.</li>
    <li><strong>Right to data portability</strong> Receive your data in a structured, machine-readable format.</li>
    <li><strong>Right to restrict processing</strong> Request limitation of processing in certain circumstances.</li>
    <li><strong>Right to object</strong> Object to processing based on legitimate interest.</li>
    <li><strong>Right to withdraw consent</strong> Withdraw consent for marketing emails at any time in Settings.</li>
  </ul>
  <p>To exercise any of these rights, contact us at <strong>[your email address]</strong>. We will respond within 30 days. You also have the right to lodge a complaint with a supervisory authority (e.g., Datatilsynet in Norway).</p>

  <h2>8. Security</h2>
  <p>We implement appropriate technical and organizational measures to protect your data, including: passwords are hashed using scrypt with unique salts; all data in transit is encrypted via HTTPS/TLS; authentication tokens are cryptographically generated; database access is restricted and authenticated.</p>
  <p>No system is 100% secure. If we become aware of a data breach affecting your personal data, we will notify you and the relevant supervisory authority as required by law.</p>

  <h2>9. Cookies and Local Storage</h2>
  <p>ViralTrack uses minimal client-side storage. We store an authentication token in your browser's localStorage to maintain your session. We do not use tracking cookies, advertising cookies, or third-party analytics cookies. No data is shared with advertisers.</p>

  <h2>10. Children's Privacy</h2>
  <p>The Service is not intended for children under 16 years of age. We do not knowingly collect personal data from children under 16. If you believe a child under 16 has provided us with personal data, contact us and we will delete it promptly.</p>

  <h2>11. Changes to This Policy</h2>
  <p>We may update this Privacy Policy to reflect changes in our practices or legal requirements. We will notify you of material changes via email or a notice in the Service. Continued use after notification constitutes acceptance of the updated policy.</p>

  <h2>12. Contact Us</h2>
  <p>For any questions about this Privacy Policy or your personal data, contact:</p>
  <p><strong>ViralTrack</strong><br>Email: <strong>[your email address]</strong></p>
  <p>You may also contact the Norwegian Data Protection Authority (Datatilsynet) at <strong>datatilsynet.no</strong> if you have concerns about our data processing practices.</p>

  <div class="doc-footer">
    <div><a href="/terms.html">Terms of Service</a></div>
    <span>&copy; 2026 ViralTrack. All rights reserved.</span>
  </div>
</div>
</body>
</html>
PRIVEOF

# ── 3. Legg til lenker i index.html ──
echo "🔗 Legger til lenker i index.html..."

# Legg til footer-lenker på landingssiden (før auth-wrap lukkes)
sed -i 's|</div>\n\n<!-- APP (hidden until logged in) -->|</div>\n\n<div style="text-align:center;padding:32px 24px 48px;font-size:13px;color:#6b6279"><a href="/terms.html" style="color:#8b5cf6;text-decoration:none">Terms of Service</a> <span style="margin:0 8px">·</span> <a href="/privacy.html" style="color:#8b5cf6;text-decoration:none">Privacy Policy</a></div>\n\n</div>\n\n<!-- APP (hidden until logged in) -->|' frontend/public/index.html 2>/dev/null

# Enklere metode: legg til rett før </body>
if ! grep -q "terms.html" frontend/public/index.html; then
  # Legg til lenker i settings-siden (etter logout-knappen)
  sed -i 's|<button class="logout-btn" id="btn-logout">Log out</button></div>|<button class="logout-btn" id="btn-logout">Log out</button><div style="text-align:center;padding:20px 0 0;font-size:12px;color:#6b6279"><a href="/terms.html" style="color:#8b5cf6;text-decoration:none" target="_blank">Terms of Service</a> <span style="margin:0 6px">·</span> <a href="/privacy.html" style="color:#8b5cf6;text-decoration:none" target="_blank">Privacy Policy</a></div></div>|' frontend/public/index.html

  # Legg til lenker på landingssiden (rett før auth-wrap lukkes)
  sed -i 's|<div class="l-trust">Free to use|<div class="l-trust"><a href="/terms.html" style="color:#8b5cf6;text-decoration:none">Terms</a> · <a href="/privacy.html" style="color:#8b5cf6;text-decoration:none">Privacy</a> · Free to use|' frontend/public/index.html
fi

echo ""
echo "✅ Ferdig! Tre ting er lagt til:"
echo "   📄 frontend/public/terms.html"
echo "   📄 frontend/public/privacy.html"  
echo "   🔗 Lenker i index.html (landingsside + settings)"
echo ""
echo "⚠️  VIKTIG: Åpne terms.html og privacy.html og erstatt"
echo "   [your email address] med din faktiske e-postadresse."
echo ""
echo "📦 For å publisere til Render, kjør:"
echo "   git add -A"
echo "   git commit -m 'Add Terms of Service and Privacy Policy'"
echo "   git push"
echo ""
echo "🌐 Sidene blir tilgjengelige på:"
echo "   https://din-app.onrender.com/terms.html"
echo "   https://din-app.onrender.com/privacy.html"

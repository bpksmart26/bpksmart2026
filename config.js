// ============================================================
// BPK Smart 2026 — 설정 파일
// Apps Script 배포 후 아래 URL을 입력하세요.
// ============================================================

// Google Apps Script 웹앱 배포 URL (배포 후 여기에 붙여넣기)
// 예: 'https://script.google.com/macros/s/AKfycb.../exec'
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwILLBpCW7rKyzupkrzxcnETVXP1qhPLVUYUsVe8nfPs8mbMdyNSaurdSjPF56P45eB/exec';

// true = API 사용 / false = localStorage 전용 (URL 미설정 시 자동 fallback)
const API_ENABLED = typeof APPS_SCRIPT_URL !== 'undefined' && APPS_SCRIPT_URL.trim().length > 0;

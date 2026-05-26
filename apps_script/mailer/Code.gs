// ============================================================
// BPK Mailer — bpksmart26@gmail.com Apps Script
// 단일 책임: 인증된 요청을 받아 GmailApp으로 메일 발송
// 이 코드는 bpksmart26 계정에서 별도 Apps Script 프로젝트로 배포되며,
// 본 레포에는 추적용 사본으로만 보관됨
// ============================================================

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('MAILER_TOKEN');
    if (!expected) return out({ ok:false, error:'MAILER_TOKEN not configured' });
    if (body.token !== expected) return out({ ok:false, error:'unauthorized' });

    if (!body.to || !body.subject || !body.html) {
      return out({ ok:false, error:'missing fields: to/subject/html' });
    }

    var opts = {
      htmlBody: body.html,
      name: '주식회사 비피케이',
      replyTo: 'bpksmart26@gmail.com'
    };

    if (Array.isArray(body.attachments) && body.attachments.length) {
      opts.attachments = body.attachments.map(function(a) {
        var bytes = Utilities.base64Decode(a.base64);
        return Utilities.newBlob(bytes, a.mime || 'application/octet-stream', a.name);
      });
    }

    if (body.cc) {
      opts.cc = body.cc;
    }

    GmailApp.sendEmail(body.to, body.subject, '', opts);
    return out({ ok:true, sentAt: new Date().toISOString() });

  } catch (err) {
    return out({ ok:false, error: String(err && err.message || err) });
  }
}

function doGet(e) {
  return out({ ok:true, msg:'BPK Mailer alive', ts: new Date().toISOString() });
}

function out(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// 에디터에서 토큰 검증 우회 + 직접 발송 테스트용
function _test_send() {
  GmailApp.sendEmail('bpksmart26@gmail.com', '[BPK Mailer] 테스트', '본문', {
    htmlBody: '<h1>테스트</h1><p>정상 동작</p>',
    name: '주식회사 비피케이'
  });
  Logger.log('테스트 발송 완료. bpksmart26 받은편지함 확인.');
}

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseKbSecuritiesStatement } from '../src/utils/brokerStatements/kbSecuritiesParser.js';
import { parseBrokerStatement } from '../src/utils/brokerStatements/index.js';

const item = (text, x, top) => ({ text, x, top });

const statementPage = {
  items: [
    item('외화', 232.9, 35.5),
    item('입출금', 265.5, 35.5),
    item('거래내역', 311.1, 35.5),
    item('계좌번호:', 37.6, 63),
    item('378-463-270-01 [종합위탁]', 93.7, 63.1),
    item('처리일자', 33.7, 127.8),
    item('구분', 123.5, 127.8),
    item('은행명', 211.3, 127.8),
    item('수취인성명', 300.5, 127.8),
    item('당사처리상태', 499.8, 127.8),
    item('처리시간', 33.7, 146.3),
    item('이체금액', 113.5, 146.3),
    item('통화코드', 305.5, 146.3),
    item('은행처리상태', 499.8, 146.3),
    item('2026/07/14', 28.8, 167.4),
    item('외화연계입금', 103.4, 167.4),
    item('국민은행', 206.4, 167.4),
    item('ChanhoSong', 300.7, 167.4),
    item('정상', 519.6, 167.4),
    item('14:13:40', 33.7, 193.8),
    item('3,000.00', 138, 193.8),
    item('USD', 318, 193.8),
    item('정상', 519.6, 193.8),
  ],
};

test('실제 KB 외화이체 표의 두 줄짜리 행을 좌표로 파싱한다', async () => {
  const result = await parseKbSecuritiesStatement({ pages: [statementPage], fileName: 'sample.pdf' });
  assert.equal(result.broker, 'KB_SECURITIES');
  assert.match(result.accountDisplay, /270-01$/);
  assert.equal(result.transactions.length, 1);

  const [transaction] = result.transactions;
  assert.equal(transaction.transactionDate, '2026-07-14');
  assert.equal(transaction.transactionTime, '14:13:40');
  assert.equal(transaction.rawType, '외화연계입금');
  assert.equal(transaction.normalizedType, 'DEPOSIT');
  assert.equal(transaction.amount, 3000);
  assert.equal(transaction.currency, 'USD');
  assert.equal(transaction.bankName, '국민은행');
  assert.equal(transaction.recipientName, 'ChanhoSong');
  assert.equal(transaction.companyStatus, '정상');
  assert.equal(transaction.bankStatus, '정상');
  assert.ok(transaction.sourceHash.length >= 8);
});

test('샘플에서 확인되지 않은 원문 유형은 출금으로 추측하지 않고 UNKNOWN으로 둔다', async () => {
  const page = {
    items: statementPage.items.map((entry) => (
      entry.text === '외화연계입금' ? { ...entry, text: '알수없는거래' } : entry
    )),
  };
  const result = await parseKbSecuritiesStatement({ pages: [page] });
  assert.equal(result.transactions[0].normalizedType, 'UNKNOWN');
});

test('당사/은행 상태 중 하나라도 정상이 아니면 UNKNOWN으로 둔다', async () => {
  let changed = false;
  const page = {
    items: statementPage.items.map((entry) => {
      if (!changed && entry.text === '정상' && entry.top === 193.8) {
        changed = true;
        return { ...entry, text: '오류' };
      }
      return entry;
    }),
  };
  const result = await parseKbSecuritiesStatement({ pages: [page] });
  assert.equal(result.transactions[0].normalizedType, 'UNKNOWN');
});

test('KB 제목이나 계좌번호가 없는 PDF는 자동 추측하지 않는다', async () => {
  await assert.rejects(
    parseKbSecuritiesStatement({ pages: [{ items: [item('다른 문서', 10, 10)] }] }),
    /KB_FOREIGN_TRANSFER_STATEMENT_NOT_DETECTED/,
  );
});

test('증권사 선택 없이 PDF 제목으로 KB parser를 자동 감지한다', async () => {
  const result = await parseBrokerStatement({ pages: [statementPage], fileName: 'sample.pdf' });
  assert.equal(result.broker, 'KB_SECURITIES');
  assert.equal(result.brokerName, 'KB증권');
  assert.equal(result.transactions.length, 1);
});

test('지원하지 않는 문서는 특정 증권사로 추측하지 않는다', async () => {
  await assert.rejects(
    parseBrokerStatement({ pages: [{ items: [item('다른 증권사', 10, 10)] }] }),
    /BROKER_STATEMENT_NOT_SUPPORTED/,
  );
});

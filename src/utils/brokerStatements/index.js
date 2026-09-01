import {
  isKbSecuritiesStatement,
  parseKbSecuritiesStatement,
} from './kbSecuritiesParser.js';

const BROKER_PARSERS = [
  {
    broker: 'KB_SECURITIES',
    brokerName: 'KB증권',
    matches: isKbSecuritiesStatement,
    parse: parseKbSecuritiesStatement,
  },
];

/**
 * 문서에 실제로 적힌 제목을 기준으로 증권사를 감지한 뒤 해당 parser에 위임한다.
 * 새 증권사는 이 registry에 독립 parser만 추가한다.
 */
export const parseBrokerStatement = async ({ pages = [], fileName = '' } = {}) => {
  const parser = BROKER_PARSERS.find((candidate) => candidate.matches(pages));
  if (!parser) throw new Error('BROKER_STATEMENT_NOT_SUPPORTED');

  const result = await parser.parse({ pages, fileName });
  return {
    ...result,
    broker: parser.broker,
    brokerName: parser.brokerName,
  };
};

export const supportedBrokerNames = BROKER_PARSERS.map((parser) => parser.brokerName);

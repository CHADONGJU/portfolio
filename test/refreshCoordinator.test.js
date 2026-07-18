import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshCoordinator } from '../src/utils/refreshCoordinator.js';

test('진행 중인 자동 동기화가 있으면 중복 실행을 만들지 않는다', () => {
  const coordinator = createRefreshCoordinator();
  const automaticRun = coordinator.begin();

  assert.equal(automaticRun, 1);
  assert.equal(coordinator.begin(), null);
  assert.equal(coordinator.isCurrent(automaticRun), true);
});

test('기존 실행이 끝난 뒤 수동 새로고침은 새 실행 번호로 시작한다', () => {
  const coordinator = createRefreshCoordinator();
  const automaticRun = coordinator.begin();

  assert.equal(coordinator.finish(automaticRun), true);
  const manualRun = coordinator.begin();
  assert.equal(manualRun, 2);
  assert.equal(coordinator.isCurrent(manualRun), true);
});

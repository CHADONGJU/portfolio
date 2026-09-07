# 보존한 이전 계산 방식

`annualPerformance.js`는 입출금과 평가 스냅샷을 사용하던 이전 연간성과 계산입니다.
현재 화면은 `src/utils/annualTradeReturn.js`의 매도분 취득원가 대비 수익률을 사용합니다.
이 코드는 앱 번들에 포함하지 않으며, 이전 계산을 조사할 수 있도록 관련 테스트와 함께 보존합니다.

기존 `capitalFlows`와 `portfolioSnapshots` 데이터는 계정 저장·동기화 과정에서 그대로 유지합니다.
화면에서 사용하지 않는 일별 스냅샷은 더 이상 자동 생성하지 않습니다.

import { Children, cloneElement, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableItems = (container) => (
  container
    ? [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter((element) => element.offsetParent !== null || element === document.activeElement)
    : []
);

/**
 * 모달 껍데기.
 *
 * 예전에는 모달이 그냥 `<div className="fixed inset-0">`이었다. 그래서
 * - 스크린리더가 뒤에 있는 포트폴리오 전체를 그대로 읽었고(role/aria-modal 없음),
 * - Tab이 모달 밖으로 새어 나갔으며,
 * - 잘못 연 매도 모달을 Escape로 닫을 수 없었고,
 * - 닫은 뒤 포커스가 어디로 갔는지 알 수 없었다.
 *
 * 자식 패널 엘리먼트에 필요한 속성만 얹으므로 기존 레이아웃(flex 정렬, 최대 너비)은
 * 그대로 유지된다.
 */
const ModalOverlay = ({ onClose, labelledBy, overlayClassName = '', children }) => {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const panel = panelRef.current;
    const initialTarget = getFocusableItems(panel)[0] || panel;
    initialTarget?.focus?.({ preventScroll: true });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = getFocusableItems(panelRef.current);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  const panel = Children.only(children);

  return (
    /*
     * 배경 클릭으로는 닫지 않는다. 입력 중인 값을 드래그로 선택하다가 패널 밖에서
     * 마우스를 놓기만 해도 폼이 통째로 사라지기 때문이다. 닫는 방법은 Escape와
     * 닫기 버튼 두 가지로 충분하다.
     *
     * 패널 안쪽에서 max-h로 스크롤을 만들어도, 브라우저 창 자체가 그 max-h 기준
     * 화면(예: 88vh)보다 작으면(배율 확대, 작은 창) 패널이 뷰포트 밑으로 그대로
     * 삐져나가고 닿을 방법이 없었다. 오버레이 자체를 스크롤 가능하게 감싸서, 패널이
     * 뷰포트보다 커지는 어떤 경우에도 스크롤해서 전체를 볼 수 있게 한다.
     */
    <div
      className={`fixed inset-0 bg-ink/60 backdrop-blur-[2px] overflow-y-auto anim-fade ${overlayClassName}`}
      role="presentation"
    >
      <div className="min-h-full flex items-end md:items-center justify-center p-0 md:p-4">
        {cloneElement(panel, {
          ref: panelRef,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': labelledBy,
          tabIndex: -1,
        })}
      </div>
    </div>
  );
};

export default ModalOverlay;

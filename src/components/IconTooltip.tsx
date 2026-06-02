import { cloneElement, useId, useState, type ReactElement } from 'react';

interface IconTooltipProps {
  label: string;
  hint: string;
  align?: 'start' | 'center' | 'end';
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

export function IconTooltip({ label, hint, align = 'center', children }: IconTooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <span
      className="icon-tooltip-wrap"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {cloneElement(children, visible ? { 'aria-describedby': id } : {})}
      {visible && (
        <span role="tooltip" id={id} className={`icon-tooltip icon-tooltip--${align}`}>
          <span className="icon-tooltip__label">{label}</span>
          <span className="icon-tooltip__hint">{hint}</span>
        </span>
      )}
    </span>
  );
}

import type { ComponentPropsWithoutRef } from 'react';

type RpgWindowProps = ComponentPropsWithoutRef<'section'>;

export function RpgWindow({
  children,
  className = '',
  ...props
}: RpgWindowProps) {
  return (
    <section
      {...props}
      className={`rpg-window ${className}`.trim()}
    >
      {children}
    </section>
  );
}
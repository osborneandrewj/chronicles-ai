"use client";

import { useEffect, useRef } from "react";

import type { SlashCommand } from "@/lib/slash-commands";

type Props = {
  commands: SlashCommand[];
  activeIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onHover: (index: number) => void;
};

export function SlashCommandMenu({ commands, activeIndex, onSelect, onHover }: Props) {
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/95 shadow-2xl">
      <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
        {commands.map((cmd, i) => {
          const active = i === activeIndex;
          return (
            <li
              key={cmd.name}
              ref={active ? activeRef : undefined}
              role="option"
              aria-selected={active}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(cmd);
              }}
              className={`flex cursor-pointer items-baseline gap-3 px-3 py-2 text-sm ${
                active ? "bg-neutral-800/80" : ""
              }`}
            >
              <span className="font-mono text-amber-500/90">{cmd.name}</span>
              <span className="text-xs text-neutral-500">{cmd.description}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

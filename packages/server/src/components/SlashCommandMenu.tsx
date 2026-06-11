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
    <div className="absolute right-0 bottom-full left-0 mb-2 max-w-full overflow-hidden rounded-2xl border border-neutral-700/80 bg-[#1b1c1f] shadow-2xl shadow-black/50">
      <ul className="max-h-72 overflow-y-auto py-2" role="listbox">
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
              className={`flex min-h-12 cursor-pointer flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-baseline sm:gap-3 ${
                active ? "bg-neutral-800/80" : ""
              }`}
            >
              <span className="font-mono text-amber-500/90">{cmd.name}</span>
              <span className="text-sm leading-snug text-neutral-500 sm:text-xs">{cmd.description}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

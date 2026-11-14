"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe, Layers, FileText, Activity } from "lucide-react";

const navItems = [
  { label: "Overview", href: "/overview", icon: Globe },
  { label: "Comparison", href: "/", icon: Layers },
  { label: "Analysis", href: "/analysis", icon: Activity },
  { label: "Report", href: "/report", icon: FileText },
];

export default function Navbar() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Mission navigation"
      className="fixed inset-x-0 bottom-0 z-50 text-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="relative h-[56px] md:h-[64px]">
        {/* Continuous outer frame */}
        <div
          className="absolute inset-0 border border-[#34445e] bg-gradient-to-b from-[#202c42] to-[#0c1322]"
          style={{
            clipPath:
              "polygon(0 0, 28% 0, 30% 22%, 72% 22%, 74% 0, 100% 0, 100% 100%, 0 100%)",
          }}
        />

        {/* Project Name */}
        {/* Project Name */}
        <div className="absolute left-4 top-1/2 z-10 hidden -translate-y-1/2 items-center gap-2 lg:flex xl:left-8">
          <span className="select-none whitespace-nowrap text-[13px] font-semibold tracking-[0.12em] text-[#e4e0e0] drop-shadow-[0_0_8px_rgba(129,153,185,0.18)]">
            TARS
          </span>
        </div>

        {/* Navigation Panel */}
        <div
          className="absolute inset-y-0 left-1/2 h-full w-full -translate-x-1/2 sm:w-[79%] sm:max-w-[800px] sm:[clip-path:polygon(0_100%,8%_22%,12%_22%,17%_0,83%_0,88%_22%,92%_22%,100%_100%)]"
          style={{
            background: "linear-gradient(180deg, #080b13 0%, #03060c 100%)",
          }}
        >
          {/* Fine top edge */}
          <div className="absolute inset-x-[17%] top-0 h-px bg-gradient-to-r from-transparent via-[#63738d]/60 to-transparent sm:block" />

          {/* Navigation Icons */}
          <div className="relative flex h-full items-end justify-center gap-1 px-3 pb-2 sm:gap-4 sm:px-8 md:gap-8 md:px-12 md:pb-[8px]">
            {navItems.map(({ label, href, icon: Icon }) => {
              const active = isActive(href);

              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex h-[36px] min-w-0 flex-1 flex-col items-center justify-center gap-[2px] md:h-[42px] ${
                    active
                      ? "text-white"
                      : "text-[#68758a] hover:text-slate-200"
                  }`}
                >
                  <Icon
                    size={19}
                    strokeWidth={active ? 2.2 : 1.8}
                    className={`md:h-[23px] md:w-[23px] ${
                      active
                        ? "drop-shadow-[0_0_4px_rgba(255,255,255,0.35)]"
                        : ""
                    }`}
                  />

                  <span className="whitespace-nowrap text-[8px] leading-[10px] sm:text-[9px] md:text-[11px] md:leading-[13px]">
                    {label}
                  </span>

                  {active && (
                    <span className="absolute bottom-0 h-px w-5 bg-white/80 md:h-[2px] md:w-6" />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}

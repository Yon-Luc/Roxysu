import React, { createContext, useContext } from "react";
import { colors, radius, spacing } from "./theme";
import { mergeStyles } from "./lib/merge-styles";
import type { EventPayload, StyleDesc } from "@gpuix/react";

interface SidebarContextValue {
  collapsed: boolean;
}

const SidebarContext = createContext<SidebarContextValue>({ collapsed: false });

export interface SidebarProps {
  collapsed?: boolean;
  children?: React.ReactNode;
  style?: StyleDesc;
}

export function Sidebar({ collapsed = false, children, style }: SidebarProps) {
  return (
    <SidebarContext.Provider value={{ collapsed }}>
      <div
        style={mergeStyles(
          {
            display: "flex",
            flexDirection: "column",
            width: collapsed ? 64 : 240,
            flexShrink: 0,
            height: "100%",
            padding: spacing.sm,
            gap: spacing.sm,
            backgroundColor: colors.card,
            borderRightWidth: 1,
            borderColor: colors.border,
          },
          style,
        )}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function SidebarHeader({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  const { collapsed } = useContext(SidebarContext);

  return (
    <div
      style={mergeStyles(
        { display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", padding: spacing.sm },
        style,
      )}
    >
      {collapsed ? null : children}
    </div>
  );
}

export function SidebarContent({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <div
      style={mergeStyles(
        { display: "flex", flexDirection: "column", gap: spacing.xs, flexGrow: 1, minHeight: 0 },
        style,
      )}
    >
      {children}
    </div>
  );
}

export function SidebarFooter({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  return (
    <div style={mergeStyles({ display: "flex", flexDirection: "column", gap: spacing.xs }, style)}>
      {children}
    </div>
  );
}

export interface SidebarItemProps {
  active?: boolean;
  icon?: React.ReactNode;
  collapsed?: boolean;
  children?: React.ReactNode;
  onClick?: (event: EventPayload) => void;
}

export function SidebarItem({ active = false, icon, collapsed: collapsedProp, children, onClick }: SidebarItemProps) {
  const { collapsed: ctxCollapsed } = useContext(SidebarContext);
  const collapsed = collapsedProp ?? ctxCollapsed;

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap: spacing.sm,
        height: 36,
        paddingLeft: collapsed ? 0 : spacing.sm,
        paddingRight: collapsed ? 0 : spacing.sm,
        borderRadius: radius.sm,
        cursor: "pointer",
        userSelect: "none",
        backgroundColor: active ? colors.secondary : "transparent",
        color: active ? colors.foreground : colors.mutedForeground,
      }}
    >
      {collapsed ? (icon ?? children) : children}
    </div>
  );
}

export function SidebarLabel({ children, style }: { children?: React.ReactNode; style?: StyleDesc }) {
  const { collapsed } = useContext(SidebarContext);

  if (collapsed) {
    return null;
  }

  return (
    <text style={mergeStyles({ fontSize: 13, fontWeight: 500, color: "inherit", lineHeight: 18 }, style)}>
      {children}
    </text>
  );
}

export function SidebarSeparator({ style }: { style?: StyleDesc }) {
  return (
    <div
      style={mergeStyles(
        { height: 1, backgroundColor: colors.border, margin: spacing.xs },
        style,
      )}
    />
  );
}

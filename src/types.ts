export type WidgetType = 'clock' | 'status';

export interface WidgetRect {
  id: string;
  type: WidgetType;
  x: number; // relative 0..1
  y: number; // relative 0..1
  width: number; // relative 0..1
  height: number; // relative 0..1
}

export interface MonitorInfo {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProfileData {
  selectedMonitorId: string;
  widgets: WidgetRect[];
}

export type OverlayMode = 'edit' | 'run';

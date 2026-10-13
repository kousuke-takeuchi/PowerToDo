import type { SyncState } from "../components/SyncStatus";

export type { SyncState };

export type Priority = 1 | 2 | 3 | 4;
export interface Task { no: number; project: string; category: string | null; title: string; assignee: string; priority: Priority; progress: number; start?: string; due?: string; dueTime?: string; days?: number; note?: string; parentNo?: number; labels: string[]; rrule?: string; reminders: string[]; order: number; createdAt: string; completedAt?: string; }
export interface Project { name: string; color: string; order: number; favorite: boolean; inbox: boolean; }
export interface Label { name: string; color: string; order: number; }
export interface Section { project: string; name: string; order: number; collapsed?: boolean; }
export interface SyncInfo { state: SyncState; lastSyncedAt?: string; target: "google" | "nas" | "none"; account?: string; }

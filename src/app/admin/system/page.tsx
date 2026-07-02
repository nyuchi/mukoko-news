"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Settings, Server, Database, Clock, RefreshCw, Check, Loader2 } from "lucide-react";

export default function AdminSystemPage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setTimeout(() => setLoading(false), 500);
  }, []);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/admin"
          className="w-10 h-10 flex items-center justify-center rounded-full bg-surface hover:bg-elevated transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">System Settings</h1>
          <p className="text-text-secondary">Platform configuration and status</p>
        </div>
      </div>

      {/* System Status */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">System Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-surface rounded-xl border border-elevated p-5">
            <div className="flex items-center gap-3 mb-3">
              <Server className="w-6 h-6 text-green-500" />
              <span className="font-medium text-foreground">API Server</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm text-text-secondary">Operational</span>
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-elevated p-5">
            <div className="flex items-center gap-3 mb-3">
              <Database className="w-6 h-6 text-green-500" />
              <span className="font-medium text-foreground">Database</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm text-text-secondary">Connected</span>
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-elevated p-5">
            <div className="flex items-center gap-3 mb-3">
              <Clock className="w-6 h-6 text-blue-500" />
              <span className="font-medium text-foreground">RSS Scheduler</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm text-text-secondary">Running</span>
            </div>
          </div>
        </div>
      </section>

      {/* Configuration */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Configuration</h2>
        <div className="bg-surface rounded-xl border border-elevated divide-y divide-elevated">
          <div className="flex items-center justify-between p-5">
            <div>
              <p className="font-medium text-foreground">RSS Sync Interval</p>
              <p className="text-sm text-text-secondary">How often to fetch new articles</p>
            </div>
            <select className="px-4 py-2 bg-elevated rounded-lg text-foreground border-none outline-none">
              <option>Every 5 minutes</option>
              <option>Every 15 minutes</option>
              <option>Every 30 minutes</option>
              <option>Every hour</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-5">
            <div>
              <p className="font-medium text-foreground">Article Retention</p>
              <p className="text-sm text-text-secondary">How long to keep old articles</p>
            </div>
            <select className="px-4 py-2 bg-elevated rounded-lg text-foreground border-none outline-none">
              <option>30 days</option>
              <option>60 days</option>
              <option>90 days</option>
              <option>Forever</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-5">
            <div>
              <p className="font-medium text-foreground">Cache TTL</p>
              <p className="text-sm text-text-secondary">API response cache duration</p>
            </div>
            <select className="px-4 py-2 bg-elevated rounded-lg text-foreground border-none outline-none">
              <option>5 minutes</option>
              <option>15 minutes</option>
              <option>30 minutes</option>
            </select>
          </div>
        </div>
      </section>

      {/* Actions */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button className="flex items-center gap-2 px-4 py-2.5 bg-primary text-on-primary rounded-xl font-medium hover:opacity-90">
            <RefreshCw className="w-4 h-4" />
            Clear Cache
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 bg-surface border border-elevated text-foreground rounded-xl font-medium hover:bg-elevated">
            <Database className="w-4 h-4" />
            Rebuild Indexes
          </button>
        </div>
      </section>
    </div>
  );
}

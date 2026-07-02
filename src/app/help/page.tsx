"use client";

import Link from "next/link";
import { Mail, MessageCircle, ChevronRight } from "lucide-react";

const faqs = [
  {
    question: "How do I personalize my news feed?",
    answer: "When you first open the app, you'll be asked to select your countries and interests. You can update these anytime by clicking the settings icon on the Feed page."
  },
  {
    question: "What is NewsBytes?",
    answer: "NewsBytes is our TikTok-style vertical feed for quick news consumption. Swipe up and down to browse stories with images and key highlights."
  },
  {
    question: "How do I save articles?",
    answer: "Tap the bookmark icon on any article to save it. Access your saved articles from the profile menu."
  },
  {
    question: "Can I read news offline?",
    answer: "Yes! Articles you've viewed are cached automatically. Open articles while online and they'll be available offline later."
  },
  {
    question: "How do I change the theme?",
    answer: "Use the theme toggle in the footer to switch between light, dark, and system modes."
  },
  {
    question: "Which countries are covered?",
    answer: "We cover news from Zimbabwe, South Africa, Kenya, Nigeria, Ghana, Tanzania, Uganda, Rwanda, Ethiopia, Botswana, Zambia, and Malawi with more coming soon."
  },
];

export default function HelpPage() {
  return (
    <div className="max-w-[800px] mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground mb-2">Help Center</h1>
      <p className="text-text-secondary mb-8">
        Find answers to common questions about using Mukoko News
      </p>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-12">
        <Link
          href="mailto:support@mukoko.com"
          className="flex items-center gap-4 p-4 bg-surface rounded-xl hover:bg-elevated transition-colors"
        >
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
            <Mail className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Email Support</p>
            <p className="text-sm text-text-secondary">support@mukoko.com</p>
          </div>
        </Link>
        <Link
          href="https://x.com/mukokoafrica"
          target="_blank"
          className="flex items-center gap-4 p-4 bg-surface rounded-xl hover:bg-elevated transition-colors"
        >
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
            <MessageCircle className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Social Support</p>
            <p className="text-sm text-text-secondary">@mukokoafrica</p>
          </div>
        </Link>
      </div>

      {/* FAQs */}
      <h2 className="text-xl font-bold text-foreground mb-6">Frequently Asked Questions</h2>
      <div className="space-y-4">
        {faqs.map((faq, index) => (
          <details
            key={index}
            className="group bg-surface rounded-xl overflow-hidden"
          >
            <summary className="flex items-center justify-between p-4 cursor-pointer list-none">
              <span className="font-medium text-foreground pr-4">{faq.question}</span>
              <ChevronRight className="w-5 h-5 text-text-tertiary transition-transform group-open:rotate-90" />
            </summary>
            <div className="px-4 pb-4 text-text-secondary">
              {faq.answer}
            </div>
          </details>
        ))}
      </div>

      {/* Still need help */}
      <div className="mt-12 p-6 bg-primary/10 rounded-xl text-center">
        <h3 className="font-semibold text-foreground mb-2">Still need help?</h3>
        <p className="text-text-secondary text-sm mb-4">
          Our support team is here to assist you
        </p>
        <Link
          href="mailto:support@mukoko.com"
          className="inline-block px-6 py-2.5 bg-primary text-on-primary font-medium rounded-xl hover:opacity-90 transition-opacity"
        >
          Contact Support
        </Link>
      </div>
    </div>
  );
}

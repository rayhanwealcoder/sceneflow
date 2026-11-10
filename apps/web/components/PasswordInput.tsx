"use client";

import { useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "value"> & {
  value: string;
  onChange: (value: string) => void;
};

/** A password field with the eye toggle, shared by sign-in, reset and the account page. */
export function PasswordInput({ value, onChange, className, ...rest }: Props) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-wrap">
      <input {...rest} className={`input${className ? ` ${className}` : ""}`} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="pw-toggle" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} title={show ? "Hide password" : "Show password"}>
        {show ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </span>
  );
}

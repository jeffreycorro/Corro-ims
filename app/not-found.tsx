import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-navy-50 px-5 text-center">
      <p className="text-xs font-semibold tracking-[0.22em] text-amber-500">404</p>
      <h1 className="mt-3 font-display text-3xl text-navy-950">Page not found</h1>
      <p className="mt-2 max-w-md text-muted">
        That route is not part of the CorConDev portal.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-11 items-center rounded-md bg-navy-900 px-5 text-sm font-semibold text-white"
      >
        Return home
      </Link>
    </div>
  );
}

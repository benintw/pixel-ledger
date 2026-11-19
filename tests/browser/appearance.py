"""Test real app rendering with synthetic Auth/API responses; never use real accounts."""
from __future__ import annotations

import base64
import json
import re
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5173"
UID = "11111111-1111-4111-8111-111111111111"
LID = "22222222-2222-4222-8222-222222222222"
USER = {"id": UID, "aud": "authenticated", "role": "authenticated", "email": "appearance@example.test", "created_at": "2026-01-01T00:00:00Z", "app_metadata": {}, "user_metadata": {}}
LEDGER = {"id": LID, "user_id": UID, "name": "日常生活", "type": "daily", "base_currency": "TWD", "timezone": "Asia/Taipei", "is_default": True, "default_exchange_rate_to_twd": None}
THEMES = [("紙本手帳", "paper"), ("無印良品風", "muji"), ("火影忍者風", "shinobi")]
OUTPUT = Path("test-results/appearance")


def token_part(value: dict) -> str:
    """Encode a test-only token segment; the API is fully intercepted."""
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")


def api_response(route) -> None:
    """Serve deterministic test data instead of contacting Supabase."""
    path = urlparse(route.request.url).path
    if route.request.method == "OPTIONS":
        route.fulfill(status=204, headers={"access-control-allow-origin": "*", "access-control-allow-headers": "*"})
        return
    if path == "/auth/v1/user":
        value = USER
    elif path.endswith("/rpc/ensure_my_defaults"):
        value = None
    elif path.endswith("/ledgers"):
        value = [LEDGER]
    elif path.endswith("/categories"):
        value = [{"id": "33333333-3333-4333-8333-333333333333", "name": "早餐", "created_at": "2026-01-01T00:00:00Z"}]
    elif path.endswith("/payment_methods"):
        value = [{"id": "44444444-4444-4444-8444-444444444444", "name": "現金", "created_at": "2026-01-01T00:00:00Z"}]
    elif path.endswith("/rpc/ledger_report"):
        value = {"total": "0.00", "currency": "TWD", "count": 0, "by_category": [], "by_payment": [], "by_day": []}
    elif path.endswith("/transactions") or path.endswith("/recurring_expenses"):
        value = []
    else:
        raise AssertionError(f"Unexpected mock API request: {path}")
    route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(value))


def main() -> None:
    """Check theme persistence, light mode and mobile layouts in Chromium."""
    OUTPUT.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + 60
    while True:
        try:
            urllib.request.urlopen(BASE, timeout=2).close()
            break
        except Exception:
            if time.monotonic() > deadline:
                raise TimeoutError("Vite server did not start")
            time.sleep(1)
    expiry = int(time.time()) + 3600
    token = ".".join([token_part({"alg": "HS256", "typ": "JWT"}), token_part({"sub": UID, "aud": "authenticated", "role": "authenticated", "exp": expiry}), "test-signature"])
    session = {"access_token": token, "refresh_token": "test-refresh", "token_type": "bearer", "expires_at": expiry, "expires_in": 3600, "user": USER}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, color_scheme="dark")
        context.route("https://pixel-ledger-test.supabase.co/**", api_response)
        context.route("https://fonts.googleapis.com/**", lambda route: route.abort())
        context.route("https://fonts.gstatic.com/**", lambda route: route.abort())
        context.add_init_script("localStorage.setItem('sb-pixel-ledger-test-auth-token', " + json.dumps(json.dumps(session)) + ");")
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        for width in (390, 320):
            page.set_viewport_size({"width": width, "height": 844})
            for label, theme in THEMES:
                page.goto(BASE + "/settings")
                page.get_by_role("radio", name=re.compile(label)).check()
                assert page.locator("html").get_attribute("data-theme") == theme
                page.reload()
                page.get_by_role("radio", name=re.compile(label)).wait_for()
                assert page.get_by_role("radio", name=re.compile(label)).is_checked()
                assert page.locator("html").get_attribute("data-theme") == theme
                assert page.evaluate("getComputedStyle(document.documentElement).colorScheme") == "light"
                for path in ("/", "/add", "/history", "/reports", "/settings"):
                    page.goto(BASE + path)
                    page.get_by_role("navigation", name="主選單").wait_for()
                    assert page.locator("html").get_attribute("data-theme") == theme
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Overflow {width}px {theme} {path}"
                    assert not page.get_by_text("頁面載入失敗", exact=True).count()
                    if path == "/" and width == 390:
                        if theme == "shinobi":
                            image = page.locator(".theme-itachi img")
                            assert image.evaluate("img => img.complete && img.naturalWidth > 0"), "Itachi asset did not load"
                        page.screenshot(path=str(OUTPUT / f"{theme}-{width}.png"), full_page=True)
        assert not errors, errors
        browser.close()
    print("PASS: all 3 themes, persistence, dark-device/light-app, 320/390px x 5 pages, Itachi asset, no page errors")


if __name__ == "__main__":
    main()

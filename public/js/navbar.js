document.addEventListener("DOMContentLoaded", () => {
    const navToggle = document.getElementById("navToggle");
    const navMenu = document.getElementById("navMenu");

    if (navToggle && navMenu) {
        const closeMenu = () => {
            navMenu.classList.remove("is-open");
            navToggle.setAttribute("aria-expanded", "false");
        };

        navToggle.addEventListener("click", () => {
            const isOpen = navMenu.classList.toggle("is-open");
            navToggle.setAttribute("aria-expanded", String(isOpen));
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeMenu();
            }
        });

        document.addEventListener("click", (event) => {
            if (!navToggle.contains(event.target) && !navMenu.contains(event.target)) {
                closeMenu();
            }
        });
    }

    // Modern Apple-style flash notification dismiss + gentle auto-hide
    const flashToasts = document.querySelectorAll(".flash-toast");
    for (let toast of flashToasts) {
        const closeBtn = toast.querySelector(".flash-close");

        const dismissToast = () => {
            toast.classList.add("is-hiding");
            window.setTimeout(() => {
                toast.remove();
            }, 220);
        };

        if (closeBtn) {
            closeBtn.addEventListener("click", dismissToast);
        }

        window.setTimeout(dismissToast, 5000);
    }

    // Auto-open and scroll to targeted <details> FAQ item (e.g. /help#hosting-guide)
    const openTargetedFaq = () => {
        if (!window.location.hash) return;
        const targetId = decodeURIComponent(window.location.hash.slice(1));
        const targetEl = document.getElementById(targetId);
        if (targetEl && targetEl.tagName === "DETAILS") {
            targetEl.open = true;
            window.requestAnimationFrame(() => {
                targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
            });
        }
    };

    openTargetedFaq();
    window.addEventListener("hashchange", openTargetedFaq);

    // =========================================================================
    // Apple Liquid Glass — Interactive Cursor/Drag Caustic Glint & Sliding Pill
    // =========================================================================
    const glassSurfaces = document.querySelectorAll(".site-header, .filter-form");
    for (const surface of glassSurfaces) {
        const updatePointer = (event) => {
            const rect = surface.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            surface.style.setProperty("--gx", `${x}px`);
            surface.style.setProperty("--gy", `${y}px`);
            surface.style.setProperty("--g-opacity", "1");
        };

        surface.addEventListener("pointermove", updatePointer);
        surface.addEventListener("pointerenter", updatePointer);

        surface.addEventListener("pointerdown", (event) => {
            updatePointer(event);
            surface.classList.add("is-glass-dragging");
        });

        const releaseDrag = () => {
            surface.classList.remove("is-glass-dragging");
        };

        surface.addEventListener("pointerup", releaseDrag);
        surface.addEventListener("pointercancel", releaseDrag);
        surface.addEventListener("pointerleave", () => {
            releaseDrag();
            surface.style.setProperty("--g-opacity", "0");
        });
    }

    // Sliding Liquid Glass Water-Drop Pill inside Desktop Navbar Menu
    if (navMenu) {
        const pill = document.createElement("span");
        pill.className = "nav-liquid-pill";
        pill.setAttribute("aria-hidden", "true");
        navMenu.prepend(pill);

        const navItems = Array.from(navMenu.querySelectorAll("a, button"));

        const movePillTo = (target) => {
            if (window.innerWidth < 901) {
                pill.style.opacity = "0";
                return;
            }
            const menuRect = navMenu.getBoundingClientRect();
            const itemRect = target.getBoundingClientRect();
            pill.style.width = `${itemRect.width}px`;
            pill.style.height = `${itemRect.height}px`;
            pill.style.transform = `translate3d(${itemRect.left - menuRect.left}px, ${itemRect.top - menuRect.top}px, 0)`;
            pill.style.opacity = "1";
        };

        for (const item of navItems) {
            item.addEventListener("pointerenter", () => movePillTo(item));
            item.addEventListener("focus", () => movePillTo(item));
        }

        // Support dragging finger/mouse across navbar items like iOS 26 Liquid Glass tab bar
        let isMenuDragging = false;
        navMenu.addEventListener("pointerdown", () => {
            isMenuDragging = true;
        });
        window.addEventListener("pointerup", () => {
            isMenuDragging = false;
        });
        navMenu.addEventListener("pointermove", (event) => {
            if (!isMenuDragging || window.innerWidth < 901) return;
            const el = document.elementFromPoint(event.clientX, event.clientY);
            const hit = el ? el.closest("a, button") : null;
            if (hit && navMenu.contains(hit)) {
                movePillTo(hit);
            }
        });

        navMenu.addEventListener("pointerleave", () => {
            pill.style.opacity = "0";
        });
    }
});

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
});

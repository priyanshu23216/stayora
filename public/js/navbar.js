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
});

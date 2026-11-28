// Custom Apple macOS-style popover dropdowns for Listings Filter Bar
document.addEventListener("DOMContentLoaded", () => {
    const groups = Array.from(document.querySelectorAll(".filter-group[data-filter-select]"));
    if (groups.length === 0) return;

    const closeAll = (exceptGroup = null) => {
        for (const group of groups) {
            if (group === exceptGroup) continue;
            group.classList.remove("is-open");
            const trigger = group.querySelector(".apple-select-trigger");
            if (trigger) trigger.setAttribute("aria-expanded", "false");
        }
    };

    for (const group of groups) {
        const trigger = group.querySelector(".apple-select-trigger");
        const valueEl = group.querySelector(".apple-select-value");
        const hiddenInput = group.querySelector('input[type="hidden"]');
        const options = Array.from(group.querySelectorAll(".apple-select-option"));

        if (!trigger || !valueEl || !hiddenInput) continue;

        const toggleMenu = () => {
            const willOpen = !group.classList.contains("is-open");
            closeAll(group);
            group.classList.toggle("is-open", willOpen);
            trigger.setAttribute("aria-expanded", String(willOpen));
        };

        trigger.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleMenu();
        });

        for (const opt of options) {
            opt.addEventListener("click", (event) => {
                event.stopPropagation();
                const val = opt.dataset.value || "";
                const label = opt.dataset.label || opt.textContent.trim();

                hiddenInput.value = val;
                valueEl.textContent = label;

                for (const other of options) {
                    const isSelected = other === opt;
                    other.classList.toggle("is-selected", isSelected);
                    other.setAttribute("aria-selected", String(isSelected));
                }

                group.classList.remove("is-open");
                trigger.setAttribute("aria-expanded", "false");
            });
        }
    }

    document.addEventListener("click", () => closeAll());

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeAll();
        }
    });
});

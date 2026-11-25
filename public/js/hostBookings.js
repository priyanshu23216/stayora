document.addEventListener("DOMContentLoaded", () => {
    const propertySelect = document.getElementById("hostPropertyFilterSelect");
    const filterForm = document.getElementById("hostPropertyFilterForm");

    if (propertySelect && filterForm) {
        propertySelect.addEventListener("change", () => {
            filterForm.submit();
        });
    }
});

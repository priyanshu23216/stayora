document.addEventListener("DOMContentLoaded", () => {
    const deletePropertyForm = document.getElementById("deletePropertyForm");

    if (deletePropertyForm) {
        deletePropertyForm.addEventListener("submit", (event) => {
            const confirmed = window.confirm(
                "Are you sure you want to permanently delete this property and all of its rooms?"
            );
            if (!confirmed) {
                event.preventDefault();
            }
        });
    }

    const deleteRoomForms = document.querySelectorAll(".js-delete-room-form");

    for (let form of deleteRoomForms) {
        form.addEventListener("submit", (event) => {
            const confirmed = window.confirm(
                "Are you sure you want to delete this room?"
            );
            if (!confirmed) {
                event.preventDefault();
            }
        });
    }
});

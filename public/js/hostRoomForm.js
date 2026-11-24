document.addEventListener("DOMContentLoaded", () => {
    const roomInput = document.getElementById("roomImages");
    const roomPreview = document.getElementById("roomPreview");
    const form = document.getElementById("roomForm");
    const submitBtn = document.getElementById("submitRoomBtn");

    if (roomInput && roomPreview) {
        roomInput.addEventListener("change", () => {
            roomPreview.textContent = "";

            if (roomInput.files.length > 4) {
                alert("You can upload up to 4 room images at a time. Only the first 4 have been kept.");
                const dt = new DataTransfer();
                Array.from(roomInput.files)
                    .slice(0, 4)
                    .forEach((f) => dt.items.add(f));
                roomInput.files = dt.files;
            }

            const selected = Array.from(roomInput.files).slice(0, 4);

            for (const file of selected) {
                if (!file.type.startsWith("image/")) continue;

                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = document.createElement("img");
                    img.src = event.target.result;
                    img.alt = file.name;
                    roomPreview.appendChild(img);
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (form && submitBtn) {
        form.addEventListener("submit", () => {
            submitBtn.disabled = true;
            submitBtn.textContent = "Saving Room...";
        });
    }
});

document.addEventListener("DOMContentLoaded", () => {
    const coverInput = document.getElementById("coverImage");
    const coverPreview = document.getElementById("coverPreview");
    const galleryInput = document.getElementById("galleryImages");
    const galleryPreview = document.getElementById("galleryPreview");
    const form = document.getElementById("newListingForm");
    const submitBtn = document.getElementById("submitListingBtn");

    function renderFilePreviews(files, container, maxCount) {
        container.textContent = "";
        const selected = Array.from(files).slice(0, maxCount);

        for (const file of selected) {
            if (!file.type.startsWith("image/")) continue;

            const reader = new FileReader();
            reader.onload = (event) => {
                const img = document.createElement("img");
                img.src = event.target.result;
                img.alt = file.name;
                container.appendChild(img);
            };
            reader.readAsDataURL(file);
        }
    }

    if (coverInput && coverPreview) {
        coverInput.addEventListener("change", () => {
            renderFilePreviews(coverInput.files, coverPreview, 1);
        });
    }

    if (galleryInput && galleryPreview) {
        galleryInput.addEventListener("change", () => {
            if (galleryInput.files.length > 6) {
                alert("You can upload up to 6 gallery images at a time. Only the first 6 have been kept.");
                const dt = new DataTransfer();
                Array.from(galleryInput.files)
                    .slice(0, 6)
                    .forEach((f) => dt.items.add(f));
                galleryInput.files = dt.files;
            }
            renderFilePreviews(galleryInput.files, galleryPreview, 6);
        });
    }

    if (form && submitBtn) {
        form.addEventListener("submit", () => {
            const isEdit = submitBtn.textContent.toLowerCase().includes("save");
            submitBtn.disabled = true;
            submitBtn.textContent = isEdit ? "Saving Changes..." : "Uploading & Publishing...";
        });
    }
});

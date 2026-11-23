document.addEventListener("DOMContentLoaded", () => {
    const coverInput = document.getElementById("coverImage");
    const coverPreview = document.getElementById("coverPreview");
    const galleryInput = document.getElementById("galleryImages");
    const galleryPreview = document.getElementById("galleryPreview");
    const form = document.getElementById("newListingForm");
    const submitBtn = document.getElementById("submitListingBtn");

    function renderFilePreviews(files, container, maxCount) {
        container.innerHTML = "";
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
                alert("You can upload up to 6 gallery images. Only the first 6 will be previewed.");
            }
            renderFilePreviews(galleryInput.files, galleryPreview, 6);
        });
    }

    if (form && submitBtn) {
        form.addEventListener("submit", () => {
            submitBtn.disabled = true;
            submitBtn.textContent = "Uploading & Publishing...";
        });
    }
});

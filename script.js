document.getElementById("year").textContent = new Date().getFullYear();

const revealTargets = document.querySelectorAll(
  ".section-head, .about-card, .work, .skills li, .contact-card, .hero-inner, .hero-card"
);
revealTargets.forEach((el) => el.classList.add("reveal"));

const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add("visible"), i * 40);
        io.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);
revealTargets.forEach((el) => io.observe(el));

const heroCard = document.querySelector(".hero-card");
if (heroCard && window.matchMedia("(hover: hover)").matches) {
  heroCard.addEventListener("mousemove", (e) => {
    const r = heroCard.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    heroCard.style.transform = `rotate(0deg) translateY(-4px) rotateX(${-y * 6}deg) rotateY(${x * 6}deg)`;
  });
  heroCard.addEventListener("mouseleave", () => {
    heroCard.style.transform = "";
  });
}

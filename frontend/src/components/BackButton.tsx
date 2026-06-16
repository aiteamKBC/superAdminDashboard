import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface BackButtonProps {
  to?: string;
  label?: string;
}

export default function BackButton({ to, label = "Back" }: BackButtonProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (to) navigate(to);
    else navigate(-1);
  };

  return (
    <button
      onClick={handleClick}
      className="group mb-5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-[#5F7288] transition-all hover:bg-[#E8EFF7] hover:text-[#14264A] active:scale-95"
    >
      <ChevronLeft className="h-4 w-4 transition-transform duration-150 group-hover:-translate-x-0.5" />
      {label}
    </button>
  );
}
